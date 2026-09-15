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

  var existing = findByRequestId_(requestId);
  if (existing) {
    return success_(toSuccessPayload_(existing));
  }

  if (!isValidName_(name)) {
    return error_('INVALID_NAME', '請輸入有效的真實姓名');
  }
  if (!isValidPhone_(phone)) {
    return error_('INVALID_PHONE', '請輸入有效的手機號碼（09xxxxxxxx）');
  }

  var settings = getAllSettings_();
  if (settings.event_status !== 'ACTIVE') {
    return error_('NO_ACTIVE_EVENT', '目前沒有開放中的候補場次。');
  }
  if (!settings.registration_enabled) {
    return error_('REGISTRATION_CLOSED', '本場候補登記已結束；尚未取得候補序號者無法完成登記。');
  }

  var sessionCheck = validateFormSession_(formSessionId);
  if (!sessionCheck.valid) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  if (options.requirePin) {
    var pinResult = verifyStaffPin_(payload.staff_pin);
    if (!pinResult.ok) return pinResult;
  }

  var normalizedName = normalizeName_(name);
  var normalizedPhone = normalizePhone_(phone);

  var duplicate = findExactDuplicate_(normalizedName, normalizedPhone);
  if (duplicate) {
    return error_('DUPLICATE', '此資料已完成候補登記，顯示原候補序號。', toSuccessPayload_(duplicate));
  }

  var cap = Number(settings.waitlist_cap);
  if (cap > 0 && countActiveWaitlist_() >= cap) {
    return error_('CAPACITY_FULL', '候補名額已滿');
  }

  try {
    var row = withScriptLock_(function () {
      var latestSettings = getAllSettings_();
      if (!latestSettings.registration_enabled) {
        throw new Error('REGISTRATION_CLOSED');
      }

      var dupAgain = findExactDuplicate_(normalizedName, normalizedPhone);
      if (dupAgain) return dupAgain;

      var againByRequest = findByRequestId_(requestId);
      if (againByRequest) return againByRequest;

      if (cap > 0 && countActiveWaitlist_() >= cap) {
        throw new Error('CAPACITY_FULL');
      }

      var waitlistNo = Number(latestSettings.next_waitlist_number) || 1;
      var duplicateFlags = findDuplicateFlags_(normalizedName, normalizedPhone).join(',');

      var newRow = {
        event_id: latestSettings.event_id,
        waitlist_no: waitlistNo,
        name: String(name).trim(),
        phone: normalizePhone_(phone),
        normalized_name: normalizedName,
        normalized_phone: normalizedPhone,
        registered_at: new Date(),
        request_id: requestId,
        receipt_token: generateReceiptToken_(),
        duplicate_flags: duplicateFlags,
        status: 'active'
      };

      insertWaitlistRow_(newRow);
      setSetting_('next_waitlist_number', waitlistNo + 1);
      return newRow;
    });

    return success_(toSuccessPayload_(row));
  } catch (e) {
    if (e.message === 'REGISTRATION_CLOSED') {
      return error_('REGISTRATION_CLOSED', '本場候補登記已結束；尚未取得候補序號者無法完成登記。');
    }
    if (e.message === 'CAPACITY_FULL') {
      return error_('CAPACITY_FULL', '候補名額已滿');
    }
    throw e;
  }
}

function getReceipt_(receiptToken) {
  var row = findByReceiptToken_(receiptToken);
  if (!row) {
    return error_('NOT_FOUND', '找不到候補登記紀錄');
  }
  return success_(toSuccessPayload_(row));
}

function verifyStaffPin_(pin) {
  var settings = getAllSettings_();
  var cache = CacheService.getScriptCache();
  var lockKey = CONFIG.CACHE_PREFIX + 'pin_lock';
  var attemptKey = CONFIG.CACHE_PREFIX + 'pin_attempts';

  if (cache.get(lockKey)) {
    return error_('PIN_LOCKED', '驗證碼錯誤次數過多，請於 ' + (settings.pin_lockout_seconds || 30) + ' 秒後再試。');
  }

  var storedHash = settings.staff_pin_hash;
  if (!storedHash) {
    return error_('PIN_NOT_CONFIGURED', '尚未設定工作人員 PIN');
  }

  var salt = getScriptSecret_();
  var inputHash = hashPin_(String(pin || ''), salt);
  if (inputHash !== storedHash) {
    var attempts = Number(cache.get(attemptKey) || 0) + 1;
    var maxAttempts = Number(settings.pin_max_attempts) || CONFIG.DEFAULTS.PIN_MAX_ATTEMPTS;
    cache.put(attemptKey, String(attempts), 300);
    if (attempts >= maxAttempts) {
      cache.put(lockKey, '1', Number(settings.pin_lockout_seconds) || CONFIG.DEFAULTS.PIN_LOCKOUT_SECONDS);
      cache.remove(attemptKey);
      return error_('PIN_LOCKED', '驗證碼錯誤次數過多，請於 ' + (settings.pin_lockout_seconds || 30) + ' 秒後再試。');
    }
    return error_('PIN_INVALID', '工作人員 PIN 錯誤');
  }

  cache.remove(attemptKey);
  return success_({ verified: true });
}
