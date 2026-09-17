function getAllSettings_() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CONFIG.CACHE_PREFIX + 'settings';
  var cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    var value = data[i][1];
    if (key) settings[key] = value;
  }
  settings = coerceSettings_(settings);
  cache.put(cacheKey, JSON.stringify(settings), CONFIG.CACHE_TTL.SETTINGS);
  return settings;
}

function invalidateSettingsCache_() {
  var cache = CacheService.getScriptCache();
  var settingsKey = CONFIG.CACHE_PREFIX + 'settings';
  var cached = cache.get(settingsKey);
  if (cached) {
    var settings = JSON.parse(cached);
    if (settings.active_batch_id) {
      invalidateLotteryDisplayCache_(settings.active_batch_id);
    }
  }
  cache.remove(settingsKey);
  invalidatePublicStateCache_();
}

function getSetting_(key, defaultValue) {
  var settings = getAllSettings_();
  if (settings[key] === undefined || settings[key] === '') {
    return defaultValue;
  }
  return settings[key];
}

function setSetting_(key, value) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      invalidateSettingsCache_();
      return;
    }
  }
  sheet.appendRow([key, value]);
  invalidateSettingsCache_();
}

function setSettings_(updates) {
  Object.keys(updates).forEach(function (key) {
    setSetting_(key, updates[key]);
  });
}

function coerceSettings_(raw) {
  var boolKeys = [
    'registration_enabled', 'qr_visible', 'qr_rotation', 'show_deadline',
    'auto_close', 'lottery_locked', 'show_qr_countdown', 'show_page_number',
    'lottery_sort_asc', 'show_random_rank'
  ];
  var numKeys = [
    'qr_rotation_interval', 'token_ttl', 'form_session_ttl', 'pin_max_attempts',
    'pin_lockout_seconds', 'waitlist_cap', 'next_waitlist_number',
    'results_per_page', 'results_columns', 'carousel_seconds', 'lottery_first_batch_count'
  ];

  boolKeys.forEach(function (key) {
    if (raw[key] !== undefined && raw[key] !== '') {
      raw[key] = raw[key] === true || raw[key] === 'TRUE' || raw[key] === 'true' || raw[key] === 1 || raw[key] === '1';
    }
  });
  numKeys.forEach(function (key) {
    if (raw[key] !== undefined && raw[key] !== '') {
      raw[key] = Number(raw[key]);
    }
  });

  raw.event_status = resolveEventStatus_(raw);
  return raw;
}

function isSeedDefaultEventName_(eventName, sessionName) {
  var name = String(eventName || '').trim();
  var session = String(sessionName || '').trim();
  return (name === 'WF 盃' && session === '第 1 場') ||
    (name === CONFIG.DEFAULTS.DEFAULT_EVENT_NAME &&
      session === CONFIG.DEFAULTS.DEFAULT_SESSION_NAME);
}

function resolveEventStatus_(raw) {
  if (raw.event_status === 'ACTIVE' || raw.event_status === 'NONE') {
    return raw.event_status;
  }

  var hasData = false;
  try {
    hasData = countActiveWaitlist_() > 0 ||
      String(raw.lottery_status || 'NONE') !== 'NONE' ||
      !!raw.registration_enabled;
  } catch (err) {
    hasData = false;
  }

  if (hasData) {
    setSetting_('event_status', 'ACTIVE');
    return 'ACTIVE';
  }

  setSetting_('event_status', 'NONE');
  if (isSeedDefaultEventName_(raw.event_name, raw.session_name)) {
    setSetting_('event_name', '');
    setSetting_('session_name', '');
    raw.event_name = '';
    raw.session_name = '';
  }
  return 'NONE';
}

function applyQuickState_(state) {
  var updates = {};
  switch (state) {
    case 'OPEN':
      updates.registration_enabled = true;
      updates.qr_visible = true;
      updates.display_mode = 'OPEN';
      break;
    case 'PROCESSING':
      updates.registration_enabled = true;
      updates.qr_visible = false;
      updates.display_mode = 'PROCESSING';
      break;
    case 'CLOSED':
      updates.registration_enabled = false;
      updates.qr_visible = false;
      updates.display_mode = 'CLOSED';
      break;
    default:
      throw new Error('未知的快速狀態: ' + state);
  }
  setSettings_(updates);
  return updates;
}

function incrementNextWaitlistNumber_() {
  return withScriptLock_(function () {
    var current = Number(getSetting_('next_waitlist_number', 1));
    var next = current + 1;
    setSetting_('next_waitlist_number', next);
    return current;
  });
}
