/**
 * 工作表初始化：部署後首次讀寫試算表時自動執行。
 * 亦可手動在 Apps Script 編輯器執行 setupWaitlistSystem()。
 */
function ensureWaitlistSystemInitialized_(ss) {
  ss = ss || getSpreadsheetRaw_();

  var existingWaitlist = ss.getSheetByName(CONFIG.SHEETS.WAITLIST);
  if (existingWaitlist) {
    formatWaitlistPhoneColumnsAsText_(existingWaitlist);
    var propsForMigration = PropertiesService.getScriptProperties();
    if (propsForMigration.getProperty('WAITLIST_PHONE_NORM_V2') !== '1') {
      invalidateWaitlistIndex_();
      propsForMigration.setProperty('WAITLIST_PHONE_NORM_V2', '1');
    }
  }

  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('WAITLIST_SYSTEM_INITIALIZED') === '1') {
    return;
  }

  ensureSheet_(ss, CONFIG.SHEETS.SETTINGS, ['key', 'value']);
  var waitlistSheet = ensureSheet_(ss, CONFIG.SHEETS.WAITLIST, WAITLIST_HEADERS);
  formatWaitlistPhoneColumnsAsText_(waitlistSheet);
  ensureSheet_(ss, CONFIG.SHEETS.LOTTERY_RESULT, LOTTERY_RESULT_HEADERS);
  ensureSheet_(ss, CONFIG.SHEETS.PUBLISH_BATCHES, PUBLISH_BATCH_HEADERS);
  ensureSheet_(ss, CONFIG.SHEETS.LOTTERY_AUDIT, LOTTERY_AUDIT_HEADERS);
  ensureSheet_(ss, CONFIG.SHEETS.AUDIT_LOG, AUDIT_LOG_HEADERS);

  var lotteryAudit = ss.getSheetByName(CONFIG.SHEETS.LOTTERY_AUDIT);
  if (lotteryAudit && !lotteryAudit.isSheetHidden()) {
    lotteryAudit.hideSheet();
  }

  seedDefaultSettings_(ss);
  props.setProperty('WAITLIST_SYSTEM_INITIALIZED', '1');
}

function seedDefaultSettings_(ss) {
  var defaults = buildDefaultSettings_();
  var settingsSheet = ss.getSheetByName(CONFIG.SHEETS.SETTINGS);
  var existing = settingsSheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    existingKeys[existing[i][0]] = true;
  }

  SETTINGS_KEYS.forEach(function (key) {
    if (!existingKeys[key]) {
      settingsSheet.appendRow([key, defaults[key] !== undefined ? defaults[key] : '']);
    }
  });
}

function setupWaitlistSystem() {
  PropertiesService.getScriptProperties().deleteProperty('WAITLIST_SYSTEM_INITIALIZED');
  ensureWaitlistSystemInitialized_();
  try {
    authorizeDriveAccess();
  } catch (err) {
    Logger.log('Drive 授權提示：請手動執行 authorizeDriveAccess() — ' + (err.message || err));
  }
  Logger.log('候補系統初始化完成');
  Logger.log('Web App URL: ' + ScriptApp.getService().getUrl());
}

function buildDefaultSettings_() {
  var eventId = Utilities.getUuid();
  var defaultPin = CONFIG.DEFAULTS.DEFAULT_STAFF_PIN;
  return {
    event_id: eventId,
    event_name: CONFIG.DEFAULTS.DEFAULT_EVENT_NAME,
    session_name: CONFIG.DEFAULTS.DEFAULT_SESSION_NAME,
    event_status: 'NONE',
    registration_enabled: false,
    qr_visible: false,
    display_mode: 'CLOSED',
    mode: CONFIG.DEFAULTS.MODE,
    deadline: '',
    show_deadline: CONFIG.DEFAULTS.SHOW_DEADLINE,
    auto_close_deadline: CONFIG.DEFAULTS.AUTO_CLOSE_DEADLINE,
    show_waitlist_count: CONFIG.DEFAULTS.SHOW_WAITLIST_COUNT,
    qr_rotation: CONFIG.DEFAULTS.QR_ROTATION,
    qr_rotation_interval: CONFIG.DEFAULTS.QR_ROTATION_INTERVAL,
    token_ttl: CONFIG.DEFAULTS.TOKEN_TTL,
    form_session_ttl: CONFIG.DEFAULTS.FORM_SESSION_TTL,
    staff_pin_hash: hashPin_(defaultPin, getScriptSecret_()),
    pin_max_attempts: CONFIG.DEFAULTS.PIN_MAX_ATTEMPTS,
    pin_lockout_seconds: CONFIG.DEFAULTS.PIN_LOCKOUT_SECONDS,
    waitlist_cap: '',
    next_waitlist_number: 1,
    lottery_status: 'NONE',
    lottery_locked: false,
    active_batch_id: '',
    display_title: '',
    display_subtitle: '',
    display_image_file_id: '',
    show_display_image: CONFIG.DEFAULTS.SHOW_DISPLAY_IMAGE,
    show_qr_countdown: true,
    results_per_page: CONFIG.DEFAULTS.RESULTS_PER_PAGE,
    results_columns: '',
    carousel_seconds: CONFIG.DEFAULTS.DISPLAY_CAROUSEL_SECONDS,
    show_page_number: true,
    lottery_sort_asc: CONFIG.DEFAULTS.LOTTERY_SORT_ASC,
    show_random_rank: CONFIG.DEFAULTS.SHOW_RANDOM_RANK,
    lottery_first_batch_count: 60,
    lottery_id: ''
  };
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function formatWaitlistPhoneColumnsAsText_(sheet) {
  if (!sheet) return;
  var phoneCol = WAITLIST_HEADERS.indexOf('phone') + 1;
  var normalizedPhoneCol = WAITLIST_HEADERS.indexOf('normalized_phone') + 1;
  var lastRow = Math.max(sheet.getLastRow(), 1);
  [phoneCol, normalizedPhoneCol].forEach(function (col) {
    if (col > 0) {
      sheet.getRange(1, col, lastRow, 1).setNumberFormat('@');
    }
  });
}

function setSpreadsheetId(spreadsheetId) {
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheetId);
}
