function sanitizeFileName_(name) {
  var raw = String(name || '候補').replace(/[\\/:*?"<>|]/g, '_').trim();
  return raw || '候補';
}

function buildEventLabel_(settings) {
  settings = settings || {};
  return [settings.event_name, settings.session_name].filter(function (part) {
    return part && String(part).trim();
  }).join('_') || '候補';
}

function exportSpreadsheetCopy_(eventLabel) {
  var ss = getSpreadsheetRaw_();
  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd_HHmm');
  var copyName = '候補紀錄_' + sanitizeFileName_(eventLabel) + '_' + stamp;
  var copy = ss.copy(copyName);
  var fileId = copy.getId();
  return {
    url: copy.getUrl(),
    file_id: fileId,
    name: copyName,
    download_url: copy.getUrl(),
    download_xlsx_url: 'https://docs.google.com/spreadsheets/d/' + fileId + '/export?format=xlsx'
  };
}

function getDefaultOperationalSettings_() {
  return {
    registration_enabled: false,
    qr_visible: false,
    display_mode: 'CLOSED',
    next_waitlist_number: 1,
    lottery_status: 'NONE',
    lottery_locked: false,
    active_batch_id: '',
    lottery_id: '',
    deadline: '',
    display_title: '',
    display_subtitle: ''
  };
}

function purgeCurrentEventData_() {
  var waitlistSheet = getWaitlistSheet_();
  var lastRow = waitlistSheet.getLastRow();
  if (lastRow > 1) {
    waitlistSheet.deleteRows(2, lastRow - 1);
  }
  invalidateWaitlistCountCache_();
  clearLotteryData_();

  var auditSheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
  if (auditSheet) {
    var auditLast = auditSheet.getLastRow();
    if (auditLast > 1) auditSheet.deleteRows(2, auditLast - 1);
  }
}

function createEvent_(payload) {
  requireAdmin_();
  payload = payload || {};
  return withScriptLock_(function () {
    var settings = getAllSettings_();
    if (settings.event_status === 'ACTIVE') {
      return error_('EVENT_ACTIVE', '已有進行中的場次，請先「結束並封存」後再建立新場次。');
    }

    var eventName = String(payload.event_name || '').trim();
    if (!eventName) {
      return error_('INVALID_NAME', '請輸入活動名稱');
    }
    var sessionName = String(payload.session_name || '').trim() || '第 1 場';

    var updates = getDefaultOperationalSettings_();
    updates.event_id = Utilities.getUuid();
    updates.event_name = eventName;
    updates.session_name = sessionName;
    updates.event_status = 'ACTIVE';
    setSettings_(updates);

    appendAuditLog_('CREATE_EVENT', {
      event_id: updates.event_id,
      event_name: eventName,
      session_name: sessionName
    });

    return success_({
      settings: getAllSettings_(),
      has_active_event: true
    });
  });
}

function archiveEvent_() {
  requireAdmin_();
  return withScriptLock_(function () {
    var settings = getAllSettings_();
    if (settings.event_status !== 'ACTIVE') {
      return error_('NO_ACTIVE_EVENT', '目前沒有進行中的場次可封存');
    }
    if (settings.registration_enabled) {
      return error_('REGISTRATION_OPEN', '請先在候補管理按「結束候補」，再封存場次');
    }

    var label = buildEventLabel_(settings);
    appendAuditLog_('ARCHIVE_EVENT', {
      event_id: settings.event_id,
      event_name: settings.event_name,
      session_name: settings.session_name,
      note: label
    });

    var exportInfo = exportSpreadsheetCopy_(label);
    purgeCurrentEventData_();

    var reset = getDefaultOperationalSettings_();
    reset.event_id = Utilities.getUuid();
    reset.event_name = '';
    reset.session_name = '';
    reset.event_status = 'NONE';
    setSettings_(reset);

    return success_({
      export_url: exportInfo.url,
      download_url: exportInfo.download_xlsx_url,
      export_name: exportInfo.name
    });
  });
}
