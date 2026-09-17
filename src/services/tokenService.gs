function buildQrToken_(settings) {
  settings = settings || getAllSettings_();

  var interval =
    Number(settings.qr_rotation_interval) ||
    CONFIG.DEFAULTS.QR_ROTATION_INTERVAL;

  var rotationEnabled = !!settings.qr_rotation;

  // Rotation OFF 時固定使用同一個 window，
  // 因此同一場次會產生固定 QR Token。
  var timeWindow = rotationEnabled
    ? getCurrentTimeWindow_(interval)
    : 0;

  var token = hmacToken_(
    settings.event_id,
    timeWindow
  );

  var expiresAt = rotationEnabled
    ? (timeWindow + 1) * interval
    : 0;

  return {
    token: token,
    time_window: timeWindow,
    interval: interval,
    expires_at: expiresAt,
    rotation_enabled: rotationEnabled
  };
}

function validateQrToken_(token) {
  var settings = getAllSettings_();

  if (!settings.qr_rotation) {
    var fixedExpected = hmacToken_(settings.event_id, 0);

    if (fixedExpected === token) {
      return {
        valid: true,
        time_window: 0
      };
    }

    return {
      valid: false,
      reason: 'invalid'
    };
  }

  var interval =
    Number(settings.qr_rotation_interval) ||
    CONFIG.DEFAULTS.QR_ROTATION_INTERVAL;

  var graceSeconds =
    Number(settings.token_ttl);

  if (isNaN(graceSeconds) || graceSeconds < 0) {
    graceSeconds = 0;
  }

  var nowSeconds =
    Math.floor(Date.now() / 1000);

  var currentWindow =
    getCurrentTimeWindow_(interval);

  var windowsToCheck =
    Math.ceil(graceSeconds / interval) + 1;

  for (var i = 0; i <= windowsToCheck; i++) {
    var window = currentWindow - i;
    var expected =
      hmacToken_(settings.event_id, window);

    if (expected !== token) {
      continue;
    }

    var windowEndsAt =
      (window + 1) * interval;

    var validUntil =
      windowEndsAt + graceSeconds;

    if (nowSeconds <= validUntil) {
      return {
        valid: true,
        time_window: window,
        valid_until: validUntil
      };
    }

    return {
      valid: false,
      reason: 'expired'
    };
  }

  return {
    valid: false,
    reason: 'expired'
  };
}

function createFormSession_(token) {
  var settings = applyAutoCloseDeadline_(getAllSettings_());

  if (settings.event_status !== 'ACTIVE') {
    return error_(
      'NO_ACTIVE_EVENT',
      '目前沒有開放中的候補場次。'
    );
  }

  if (!settings.registration_enabled) {
    return error_(
      'REGISTRATION_CLOSED',
      '本場候補登記已結束。'
    );
  }

  if (!settings.qr_visible) {
    return error_(
      'REGISTRATION_CLOSED',
      '本場已停止接受新的候補登記。'
    );
  }

  var validation = validateQrToken_(token);
  if (!validation.valid) {
    return error_(
      'TOKEN_EXPIRED',
      'QR Code 已失效，請重新掃描現場目前顯示的 QR Code。'
    );
  }

  var sessionId = Utilities.getUuid();
  var ttl = Number(settings.form_session_ttl) || CONFIG.DEFAULTS.FORM_SESSION_TTL;
  var expiresAt = Math.floor(Date.now() / 1000) + ttl;
  var cache = CacheService.getScriptCache();
  cache.put(
    CONFIG.CACHE_PREFIX + 'session_' + sessionId,
    JSON.stringify({ token: token, created_at: Date.now(), expires_at: expiresAt }),
    ttl
  );

  return success_({
    form_session_id: sessionId,
    expires_at: expiresAt,
    form_session_ttl: ttl,
    mode: settings.mode || CONFIG.DEFAULTS.MODE,
    deadline: formatDeadlineForDisplay_(settings),
    show_deadline: !!settings.show_deadline,
    event_name: settings.event_name || '',
    session_name: settings.session_name || '',
    display_title: settings.display_title || '',
    display_subtitle: settings.display_subtitle || ''
  });
}

function getFormSessionCacheTtl_(settings, session) {
  if (session && session.stage === 'pin_pending') {
    return Math.min(
      Number(settings.pin_session_ttl) || CONFIG.DEFAULTS.PIN_SESSION_TTL,
      21600
    );
  }
  return Number(settings.form_session_ttl) || CONFIG.DEFAULTS.FORM_SESSION_TTL;
}

function extendFormSession_(sessionId) {
  if (!sessionId) {
    return error_(
      'SESSION_EXPIRED',
      '填寫時間已過期，請重新掃描 QR Code。'
    );
  }

  var settings = applyAutoCloseDeadline_(getAllSettings_());

  if (!settings.registration_enabled) {
    return error_(
      'REGISTRATION_CLOSED',
      '本場候補登記已結束；無法繼續完成登記。'
    );
  }

  var check = validateFormSession_(sessionId);

  if (!check.valid) {
    return error_(
      'SESSION_EXPIRED',
      '填寫時間已過期，請重新掃描 QR Code。'
    );
  }

  // 只檢查目前的 session 是否仍有效。
  // 不重新計算 expires_at，也不延長有效時間。
  return success_({
    form_session_id: sessionId,
    expires_at: check.session.expires_at || 0,
    stage: check.session.stage || ''
  });
}

function checkFormSession_(sessionId) {
  if (!sessionId) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  var settings = applyAutoCloseDeadline_(getAllSettings_());

  if (!settings.registration_enabled) {
    return error_(
      'REGISTRATION_CLOSED',
      '本場候補登記已結束；無法繼續完成登記。'
    );
  }

  var check = validateFormSession_(sessionId);
  if (!check.valid) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  return success_({
    form_session_id: sessionId,
    expires_at: check.session.expires_at || 0,
    stage: check.session.stage || ''
  });
}

function getFormSessionCacheKey_(sessionId) {
  return CONFIG.CACHE_PREFIX + 'session_' + sessionId;
}

function readFormSession_(sessionId) {
  if (!sessionId) return null;
  var raw = CacheService.getScriptCache().get(getFormSessionCacheKey_(sessionId));
  if (!raw) return null;
  return JSON.parse(raw);
}

function writeFormSession_(sessionId, session, ttlSeconds) {
  CacheService.getScriptCache().put(
    getFormSessionCacheKey_(sessionId),
    JSON.stringify(session),
    ttlSeconds
  );
}

function validateFormSession_(sessionId) {
  if (!sessionId) {
    return {
      valid: false,
      reason: 'missing'
    };
  }

  var session = readFormSession_(sessionId);

  if (!session) {
    return {
      valid: false,
      reason: 'expired'
    };
  }

  var nowSeconds =
    Math.floor(Date.now() / 1000);

  if (
    session.expires_at &&
    session.expires_at < nowSeconds
  ) {
    return {
      valid: false,
      reason: 'expired'
    };
  }

  return {
    valid: true,
    session: session
  };
}

function lockForPinVerification_(formSessionId, name, phone) {
  var settings = applyAutoCloseDeadline_(getAllSettings_());

  if (!settings.registration_enabled) {
    return error_(
      'REGISTRATION_CLOSED',
      '本場候補登記已結束；無法進入工作人員核驗。'
    );
  }
  if ((settings.mode || CONFIG.DEFAULTS.MODE) !== 'counter') {
    return error_('INVALID_MODE', '僅櫃檯核驗模式可使用 PIN 鎖定。');
  }

  var check = validateFormSession_(formSessionId);
  if (!check.valid) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  if (!isValidName_(name)) {
    return error_('INVALID_NAME', '請輸入有效的真實姓名');
  }
  if (!isValidPhone_(phone)) {
    return error_('INVALID_PHONE', '請輸入有效的手機號碼（09xxxxxxxx）');
  }


  var normalizedName = normalizeName_(name);
  var normalizedPhone = normalizePhone_(phone);
  var session = check.session;

  var nowSeconds =
    Math.floor(Date.now() / 1000);

  var pinSessionTtl =
    Math.min(
      Number(settings.pin_session_ttl) ||
        CONFIG.DEFAULTS.PIN_SESSION_TTL,
      21600
    );

  var pinExpiresAt =
    nowSeconds + pinSessionTtl;

  session.stage = 'pin_pending';
  session.expires_at = pinExpiresAt;
  session.pin_pending = {
    name: String(name).trim(),
    phone: normalizedPhone,
    normalized_name: normalizedName,
    normalized_phone: normalizedPhone,
    locked_at: Date.now()
  };

  writeFormSession_(
    formSessionId,
    session,
    pinSessionTtl
  );

  return success_({
    form_session_id: formSessionId,
    pin_pending: true
  });
}

function validatePinPendingSession_(formSessionId, name, phone) {
  if (!formSessionId) return { valid: false, reason: 'missing' };

  var session = readFormSession_(formSessionId);
  if (!session) return { valid: false, reason: 'expired' };

  var nowSeconds =
    Math.floor(Date.now() / 1000);

  if (
    session.expires_at &&
    session.expires_at < nowSeconds
  ) {
    return {
      valid: false,
      reason: 'expired'
    };
  }

  if (session.stage !== 'pin_pending' || !session.pin_pending) {
    return { valid: false, reason: 'not_locked' };
  }

  var normalizedName = normalizeName_(name);
  var normalizedPhone = normalizePhone_(phone);
  var pending = session.pin_pending;

  if (pending.normalized_name !== normalizedName ||
    pending.normalized_phone !== normalizedPhone) {
    return { valid: false, reason: 'data_mismatch' };
  }

  return { valid: true, session: session };
}

function clearFormSession_(sessionId) {
  if (!sessionId) return;
  CacheService.getScriptCache().remove(getFormSessionCacheKey_(sessionId));
}

function getCandidateUrl_() {
  return ScriptApp.getService().getUrl() + '?page=candidate';
}

function getDisplayUrl_() {
  return ScriptApp.getService().getUrl() + '?page=display';
}
