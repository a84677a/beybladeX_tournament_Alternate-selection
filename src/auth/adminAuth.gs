/**
 * Admin PIN 登入、Session 與 Rate Limit
 * Session 與 Rate Limit 使用 CacheService，不寫入 Google Sheet
 */

var ADMIN_ROLE = 'ADMIN';
var ADMIN_SESSION_PREFIX = 'admin_sess:';
var ADMIN_RATE_PREFIX = 'admin_rate:';
var ADMIN_LOCK_PREFIX = 'admin_lock:';
var _adminAuthToken_ = null;
var _adminSession_ = null;

function setAdminAuthToken_(token) {
  _adminAuthToken_ = token || null;
  _adminSession_ = null;
}

function clearAdminAuthContext_() {
  _adminAuthToken_ = null;
  _adminSession_ = null;
}

function getAdminPin_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '';
}

function getAdminSessionTtlSeconds_() {
  var hours = Number(PropertiesService.getScriptProperties().getProperty('SESSION_TTL_HOURS'));
  if (!hours || hours <= 0) hours = 12;
  // CacheService 單筆最長 6 小時；Session 過期時間仍寫在 payload 內
  return Math.min(hours * 3600, 21600);
}

function getAdminRateLimitWindowSeconds_() {
  var minutes = Number(PropertiesService.getScriptProperties().getProperty('LOGIN_RATE_LIMIT_WINDOW_MINUTES'));
  if (!minutes || minutes <= 0) minutes = 5;
  return minutes * 60;
}

function getAdminRateLimitMaxFailures_() {
  var max = Number(PropertiesService.getScriptProperties().getProperty('LOGIN_RATE_LIMIT_MAX_FAILURES'));
  if (!max || max <= 0) max = 5;
  return max;
}

function getAdminLockoutSeconds_() {
  var minutes = Number(PropertiesService.getScriptProperties().getProperty('LOGIN_LOCKOUT_MINUTES'));
  if (!minutes || minutes <= 0) minutes = 5;
  return minutes * 60;
}

function validateOperatorName_(name) {
  var value = String(name || '').trim();
  if (value.length < 2 || value.length > 30) {
    return { ok: false, message: '操作者姓名需 2～30 字' };
  }
  return { ok: true, value: value };
}

function adminRateLimitKey_(sourceId) {
  return ADMIN_RATE_PREFIX + (sourceId || 'anonymous');
}

function adminLockoutKey_(sourceId) {
  return ADMIN_LOCK_PREFIX + (sourceId || 'anonymous');
}

function checkAdminRateLimit_(sourceId) {
  if (CacheService.getScriptCache().get(adminLockoutKey_(sourceId))) {
    return { ok: false, message: '登入嘗試過多，請稍後再試' };
  }
  return { ok: true };
}

function recordAdminLoginFailure_(sourceId) {
  var cache = CacheService.getScriptCache();
  var key = adminRateLimitKey_(sourceId);
  var current = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(current), getAdminRateLimitWindowSeconds_());
  if (current >= getAdminRateLimitMaxFailures_()) {
    cache.put(adminLockoutKey_(sourceId), '1', getAdminLockoutSeconds_());
    cache.remove(key);
  }
}

function clearAdminLoginFailures_(sourceId) {
  CacheService.getScriptCache().remove(adminRateLimitKey_(sourceId));
}

function generateAdminSessionToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function adminLogin_(pin, operatorName, sourceId) {
  var adminPin = getAdminPin_();
  if (!adminPin) {
    return error_('PIN_NOT_CONFIGURED', 'ADMIN_PIN 尚未設定，請於 Script Properties 設定');
  }

  var nameCheck = validateOperatorName_(operatorName);
  if (!nameCheck.ok) {
    return error_('INVALID_NAME', nameCheck.message);
  }

  var rateCheck = checkAdminRateLimit_(sourceId);
  if (!rateCheck.ok) {
    return error_('PIN_LOCKED', rateCheck.message);
  }

  if (String(pin || '') !== adminPin) {
    recordAdminLoginFailure_(sourceId);
    return error_('PIN_INVALID', 'ADMIN PIN 驗證失敗');
  }

  clearAdminLoginFailures_(sourceId);

  var token = generateAdminSessionToken_();
  var createdAt = new Date();
  var expiresAt = new Date(createdAt.getTime() + getAdminSessionTtlSeconds_() * 1000);
  var session = {
    token: token,
    role: ADMIN_ROLE,
    operator: nameCheck.value,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  CacheService.getScriptCache().put(
    ADMIN_SESSION_PREFIX + token,
    JSON.stringify(session),
    getAdminSessionTtlSeconds_()
  );

  return success_({
    role: session.role,
    operator: session.operator,
    expiresAt: session.expiresAt,
    token: token
  });
}

function adminLogout_(token) {
  if (token) {
    CacheService.getScriptCache().remove(ADMIN_SESSION_PREFIX + token);
  }
  return success_({ loggedOut: true });
}

function getAdminSession_(token) {
  if (!token) return null;

  var raw = CacheService.getScriptCache().get(ADMIN_SESSION_PREFIX + token);
  if (!raw) return null;

  var session;
  try {
    session = JSON.parse(raw);
  } catch (e) {
    return null;
  }

  if (!session || !session.expiresAt) return null;
  if (new Date(session.expiresAt) <= new Date()) {
    CacheService.getScriptCache().remove(ADMIN_SESSION_PREFIX + token);
    return null;
  }

  return session;
}

function adminCheckSession_(token) {
  var session = getAdminSession_(token);
  if (!session || session.role !== ADMIN_ROLE) {
    return error_('SESSION_EXPIRED', 'Session 已失效，請重新登入');
  }

  // 刷新 Cache TTL，避免使用中卻因快取過期被登出
  CacheService.getScriptCache().put(
    ADMIN_SESSION_PREFIX + token,
    JSON.stringify(session),
    getAdminSessionTtlSeconds_()
  );

  return success_({
    session: {
      role: session.role,
      operator: session.operator,
      expiresAt: session.expiresAt
    }
  });
}

function requireAdmin_() {
  var token = _adminAuthToken_;
  var session = getAdminSession_(token);
  if (!session || session.role !== ADMIN_ROLE) {
    var err = new Error('Session 已失效，請重新登入');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }
  _adminSession_ = session;
  return session;
}

function getCurrentAdminOperator_() {
  if (_adminSession_) return _adminSession_.operator;
  var session = getAdminSession_(_adminAuthToken_);
  return session ? session.operator : '';
}
