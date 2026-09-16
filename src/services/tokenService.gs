function buildQrToken_(settings) {
  settings = settings || getAllSettings_();
  var interval = Number(settings.qr_rotation_interval) || CONFIG.DEFAULTS.QR_ROTATION_INTERVAL;
  var timeWindow = getCurrentTimeWindow_(interval);
  var token = hmacToken_(settings.event_id, timeWindow);
  var expiresAt = (timeWindow + 2) * interval;

  return {
    token: token,
    time_window: timeWindow,
    interval: interval,
    expires_at: expiresAt,
    rotation_enabled: !!settings.qr_rotation
  };
}

function validateQrToken_(token) {
  var settings = getAllSettings_();
  if (!settings.qr_rotation) {
    return { valid: true, reason: 'rotation_off' };
  }

  var interval = Number(settings.qr_rotation_interval) || CONFIG.DEFAULTS.QR_ROTATION_INTERVAL;
  var ttl = Number(settings.token_ttl) || CONFIG.DEFAULTS.TOKEN_TTL;
  var currentWindow = getCurrentTimeWindow_(interval);
  var windowsToCheck = Math.ceil(ttl / interval) + 1;

  for (var i = 0; i <= windowsToCheck; i++) {
    var window = currentWindow - i;
    var expected = hmacToken_(settings.event_id, window);
    if (expected === token) {
      return { valid: true, time_window: window };
    }
  }
  return { valid: false, reason: 'expired' };
}

function createFormSession_(token) {
  var settings = getAllSettings_();
  var validation = validateQrToken_(token);
  if (!validation.valid && settings.qr_rotation) {
    return error_('TOKEN_EXPIRED', 'QR Code 已失效，請重新掃描現場目前顯示的 QR Code。');
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
    deadline: settings.deadline || '',
    show_deadline: !!settings.show_deadline,
    event_name: settings.event_name || '',
    session_name: settings.session_name || '',
    display_title: settings.display_title || '',
    display_subtitle: settings.display_subtitle || ''
  });
}

function extendFormSession_(sessionId) {
  if (!sessionId) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  var check = validateFormSession_(sessionId);
  if (!check.valid) {
    return error_('SESSION_EXPIRED', '填寫時間已過期，請重新掃描 QR Code。');
  }

  var settings = getAllSettings_();
  var ttl = Number(settings.form_session_ttl) || CONFIG.DEFAULTS.FORM_SESSION_TTL;
  var expiresAt = Math.floor(Date.now() / 1000) + ttl;
  check.session.expires_at = expiresAt;

  var cache = CacheService.getScriptCache();
  cache.put(
    CONFIG.CACHE_PREFIX + 'session_' + sessionId,
    JSON.stringify(check.session),
    ttl
  );

  return success_({
    form_session_id: sessionId,
    expires_at: expiresAt
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
  if (!sessionId) return { valid: false, reason: 'missing' };
  var session = readFormSession_(sessionId);
  if (!session) return { valid: false, reason: 'expired' };

  if (session.stage === 'pin_pending') {
    return { valid: true, session: session };
  }

  if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, session: session };
}

function lockForPinVerification_(formSessionId, name, phone) {
  var settings = getAllSettings_();
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

  var pinTtl = Math.min(
    Number(settings.pin_session_ttl) || CONFIG.DEFAULTS.PIN_SESSION_TTL,
    21600
  );
  var normalizedName = normalizeName_(name);
  var normalizedPhone = normalizePhone_(phone);
  var session = check.session;

  session.stage = 'pin_pending';
  session.pin_pending = {
    name: String(name).trim(),
    phone: normalizedPhone,
    normalized_name: normalizedName,
    normalized_phone: normalizedPhone,
    locked_at: Date.now()
  };

  writeFormSession_(formSessionId, session, pinTtl);

  return success_({
    form_session_id: formSessionId,
    pin_pending: true
  });
}

function validatePinPendingSession_(formSessionId, name, phone) {
  if (!formSessionId) return { valid: false, reason: 'missing' };

  var session = readFormSession_(formSessionId);
  if (!session) return { valid: false, reason: 'expired' };

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
