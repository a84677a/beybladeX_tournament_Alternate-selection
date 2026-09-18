function registerCandidate_(payload) {
  return processRegistration_(payload, { requirePin: false });
}

function verifyAndRegister_(payload) {
  return processRegistration_(payload, { requirePin: true });
}

function processRegistration_(payload, options) {
  payload = payload || {};
  var requestId = payload.request_id;
  var name = payload.name;
  var phone = payload.phone;
  var formSessionId = payload.form_session_id;

  if (!requestId) {
    return error_('INVALID_REQUEST', '缺少 request_id');
  }

  if (!isValidName_(name)) {
    return error_('INVALID_NAME', '請輸入有效的真實姓名');
  }
  if (!isValidPhone_(phone)) {
    return error_('INVALID_PHONE', '請輸入有效的手機號碼（09xxxxxxxx）');
  }

  var normalizedName = normalizeName_(name);
  var normalizedPhone = normalizePhone_(phone);
  var precheck = lookupWaitlistForRegistration_(requestId, normalizedName, normalizedPhone);

  if (precheck.byRequestId) {
    return success_(toSuccessPayload_(precheck.byRequestId));
  }
  if (precheck.exactDuplicate) {
    return error_('DUPLICATE', '此資料已完成候補登記，顯示原候補序號。', toSuccessPayload_(precheck.exactDuplicate));
  }

  var settings = applyAutoCloseDeadline_(getAllSettings_());
  if (settings.event_status !== 'ACTIVE') {
    return error_('NO_ACTIVE_EVENT', '目前沒有開放中的候補場次。');
  }
  if (!settings.registration_enabled) {
    return error_('REGISTRATION_CLOSED', '本場候補登記已結束；尚未取得候補序號者無法完成登記。');
  }

  var sessionCheck = options.requirePin
    ? validatePinPendingSession_(formSessionId, name, phone)
    : validateFormSession_(formSessionId);
  if (!sessionCheck.valid) {
    if (sessionCheck.reason === 'data_mismatch') {
      return error_('SESSION_MISMATCH', '資料與確認時不一致，請返回重新確認。');
    }
    if (sessionCheck.reason === 'not_locked') {
      return error_('SESSION_EXPIRED', '請先完成資料確認，再交由工作人員輸入 PIN。');
    }
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  if (options.requirePin) {
    var pinResult = verifyStaffPin_(
      payload.staff_pin,
      payload.device_id,
      formSessionId
    );
    if (!pinResult.ok) return pinResult;
  }

  var cap = Number(settings.waitlist_cap);
  if (cap > 0 && countActiveWaitlist_() >= cap) {
    return error_('CAPACITY_FULL', '候補名額已滿，本場不再接受新的候補登記。');
  }

  var deadlineMs = 0;
  if (settings.auto_close_deadline) {
    var deadlineDate = getDeadlineDate_(settings);
    if (deadlineDate) deadlineMs = deadlineDate.getTime();
  }

  try {
    var row = withScriptLock_(function () {
      return finalizeRegistrationInLock_({
        requestId: requestId,
        name: name,
        normalizedName: normalizedName,
        normalizedPhone: normalizedPhone,
        cap: cap,
        duplicateFlags: precheck.duplicateFlags,
        eventId: settings.event_id,
        autoCloseDeadline: !!settings.auto_close_deadline,
        deadlineMs: deadlineMs
      });
    });

    if (row && row._duplicate) {
      return error_('DUPLICATE', '此資料已完成候補登記，顯示原候補序號。', toSuccessPayload_(row._duplicate));
    }

    clearFormSession_(formSessionId);
    return success_(toSuccessPayload_(row));
  } catch (e) {
    if (e.message === 'REGISTRATION_CLOSED') {
      return error_('REGISTRATION_CLOSED', '本場候補登記已結束；尚未取得候補序號者無法完成登記。');
    }
    if (e.message === 'CAPACITY_FULL') {
      return error_('CAPACITY_FULL', '候補名額已滿，本場不再接受新的候補登記。');
    }
    throw e;
  }
}

function finalizeRegistrationInLock_(input) {
  invalidateWaitlistIndex_();

  var byRequestId = findByRequestId_(input.requestId);
  if (byRequestId) return byRequestId;

  var exactDuplicate = findExactDuplicate_(input.normalizedName, input.normalizedPhone);
  if (exactDuplicate) {
    return { _duplicate: exactDuplicate };
  }

  if (!getSetting_('registration_enabled', false)) {
    throw new Error('REGISTRATION_CLOSED');
  }

  if (input.autoCloseDeadline && input.deadlineMs && Date.now() >= input.deadlineMs) {
    throw new Error('REGISTRATION_CLOSED');
  }

  invalidateWaitlistCountCache_();
  if (input.cap > 0 && countActiveWaitlist_() >= input.cap) {
    throw new Error('CAPACITY_FULL');
  }

  var waitlistNo = Number(getSetting_('next_waitlist_number', 1));
  var duplicateFlags = (input.duplicateFlags || []).join(',');

  var newRow = {
    event_id: input.eventId,
    waitlist_no: waitlistNo,
    name: String(input.name).trim(),
    phone: input.normalizedPhone,
    normalized_name: input.normalizedName,
    normalized_phone: input.normalizedPhone,
    registered_at: new Date(),
    request_id: input.requestId,
    receipt_token: generateReceiptToken_(),
    duplicate_flags: duplicateFlags,
    status: 'active'
  };

  insertWaitlistRow_(newRow);
  setSetting_('next_waitlist_number', waitlistNo + 1);
  return newRow;
}

function getReceipt_(receiptToken) {
  var row = findByReceiptToken_(receiptToken);
  if (!row) {
    return error_('NOT_FOUND', '找不到候補登記紀錄');
  }
  return success_(toSuccessPayload_(row));
}

function verifyStaffPin_(pin, deviceId, formSessionId) {
  var settings = getAllSettings_();
  var cache = CacheService.getScriptCache();
  var deviceKey = String(deviceId || '').trim();
  var sessionId = String(formSessionId || '').trim();
  var maxAttempts = Number(settings.pin_max_attempts) || CONFIG.DEFAULTS.PIN_MAX_ATTEMPTS;
  var lockoutSeconds = Number(settings.pin_lockout_seconds) || CONFIG.DEFAULTS.PIN_LOCKOUT_SECONDS;
  var attemptWindowSeconds = Math.max(lockoutSeconds * 10, 300);

  if (!deviceKey) {
    return error_('INVALID_DEVICE_ID', '缺少裝置識別資訊');
  }
  if (!sessionId) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  var deviceLockKey = CONFIG.CACHE_PREFIX + 'pin_lock_' + deviceKey;
  var deviceAttemptKey = CONFIG.CACHE_PREFIX + 'pin_attempts_' + deviceKey;
  var sessionAttemptKey = CONFIG.CACHE_PREFIX + 'pin_sess_' + sessionId;

  if (cache.get(deviceLockKey)) {
    return error_(
      'PIN_LOCKED',
      '此裝置 PIN 錯誤次數過多，請 ' + lockoutSeconds + ' 秒後再試。',
      { lockout_seconds: lockoutSeconds, scope: 'device' }
    );
  }

  var sessionAttempts = Number(cache.get(sessionAttemptKey) || 0);
  if (sessionAttempts >= maxAttempts) {
    clearFormSession_(sessionId);
    cache.remove(sessionAttemptKey);
    return error_(
      'PIN_SESSION_EXHAUSTED',
      '此登記的 PIN 嘗試次數已用盡，請重新掃描 QR Code 後再試。'
    );
  }

  var storedHash = settings.staff_pin_hash;
  if (!storedHash) {
    return error_('PIN_NOT_CONFIGURED', '尚未設定工作人員 PIN');
  }

  var salt = getScriptSecret_();
  var inputHash = hashPin_(String(pin || ''), salt);
  if (inputHash !== storedHash) {
    return recordStaffPinFailure_({
      cache: cache,
      deviceLockKey: deviceLockKey,
      deviceAttemptKey: deviceAttemptKey,
      sessionAttemptKey: sessionAttemptKey,
      sessionId: sessionId,
      maxAttempts: maxAttempts,
      lockoutSeconds: lockoutSeconds,
      attemptWindowSeconds: attemptWindowSeconds
    });
  }

  cache.remove(deviceAttemptKey);
  cache.remove(sessionAttemptKey);
  return success_({ verified: true });
}

function recordStaffPinFailure_(input) {
  var cache = input.cache;
  var deviceAttempts = Number(cache.get(input.deviceAttemptKey) || 0) + 1;
  var sessionAttempts = Number(cache.get(input.sessionAttemptKey) || 0) + 1;

  cache.put(input.deviceAttemptKey, String(deviceAttempts), input.attemptWindowSeconds);
  cache.put(input.sessionAttemptKey, String(sessionAttempts), input.attemptWindowSeconds);

  if (sessionAttempts >= input.maxAttempts) {
    clearFormSession_(input.sessionId);
    cache.remove(input.sessionAttemptKey);
    cache.remove(input.deviceAttemptKey);
    if (deviceAttempts >= input.maxAttempts) {
      cache.put(input.deviceLockKey, '1', input.lockoutSeconds);
    }
    return error_(
      'PIN_SESSION_EXHAUSTED',
      '此登記的 PIN 嘗試次數已用盡，請重新掃描 QR Code 後再試。'
    );
  }

  if (deviceAttempts >= input.maxAttempts) {
    cache.put(input.deviceLockKey, '1', input.lockoutSeconds);
    cache.remove(input.deviceAttemptKey);
    return error_(
      'PIN_LOCKED',
      '此裝置 PIN 錯誤次數過多，請 ' + input.lockoutSeconds + ' 秒後再試。',
      { lockout_seconds: input.lockoutSeconds, scope: 'device' }
    );
  }

  var remaining = input.maxAttempts - sessionAttempts;
  return error_(
    'PIN_INVALID',
    '工作人員 PIN 錯誤（尚可嘗試 ' + remaining + ' 次）',
    { remaining_attempts: remaining }
  );
}

function removeWaitlistEntry_(waitlistNo) {
  requireAdmin_();
  waitlistNo = Number(waitlistNo);
  if (!waitlistNo || waitlistNo < 1) {
    return error_('INVALID_WAITLIST_NO', '序號無效');
  }

  var settings = getAllSettings_();
  var found = findWaitlistSheetRow_(waitlistNo);
  if (!found) {
    return error_('NOT_FOUND', '找不到候補序號 ' + formatWaitlistNo_(waitlistNo));
  }
  if (found.row.status === 'excluded') {
    return error_('ALREADY_EXCLUDED', '此候補已剔除');
  }
  if (found.row.status !== 'active') {
    return error_('INVALID_STATUS', '此候補狀態無法剔除');
  }

  if (settings.lottery_locked) {
    var inLottery = getLotteryResults_().some(function (row) {
      return Number(row.waitlist_no) === waitlistNo;
    });
    if (inLottery) {
      return error_('LOTTERY_LOCKED', '抽選已完成，無法剔除已納入抽選的候補');
    }
  }

  if (isWaitlistNoPublished_(waitlistNo, settings)) {
    return error_('ALREADY_PUBLISHED', '此候補已公布，無法剔除');
  }

  setWaitlistRowStatus_(waitlistNo, 'excluded');
  appendAuditLog_('EXCLUDE_WAITLIST', {
    waitlist_no: waitlistNo,
    name: found.row.name
  });

  return attachAdminWaitlistRowMutation_({
    waitlist_no: formatWaitlistNo_(waitlistNo),
    message: '已剔除候補 ' + formatWaitlistNo_(waitlistNo) + '（登記者不會收到通知）'
  }, waitlistNo);
}

function restoreWaitlistEntry_(waitlistNo) {
  requireAdmin_();
  waitlistNo = Number(waitlistNo);
  if (!waitlistNo || waitlistNo < 1) {
    return error_('INVALID_WAITLIST_NO', '序號無效');
  }

  var settings = getAllSettings_();
  if (settings.lottery_locked) {
    return error_('LOTTERY_LOCKED', '抽選已完成，無法恢復候補');
  }

  var found = findWaitlistSheetRow_(waitlistNo);
  if (!found) {
    return error_('NOT_FOUND', '找不到候補序號 ' + formatWaitlistNo_(waitlistNo));
  }
  if (found.row.status !== 'excluded') {
    return error_('NOT_EXCLUDED', '此候補不在剔除狀態');
  }

  setWaitlistRowStatus_(waitlistNo, 'active');
  appendAuditLog_('RESTORE_WAITLIST', {
    waitlist_no: waitlistNo,
    name: found.row.name
  });

  return attachAdminWaitlistRowMutation_({
    waitlist_no: formatWaitlistNo_(waitlistNo),
    message: '已恢復候補 ' + formatWaitlistNo_(waitlistNo)
  }, waitlistNo);
}
