function exportEventData_(type) {
  requireAdmin_();
  var ss = getSpreadsheet_();
  var settings = getAllSettings_();
  if (settings.event_status !== 'ACTIVE') {
    return error_('NO_ACTIVE_EVENT', '請先建立場次後再匯出資料');
  }
  var timestamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');
  var label = sanitizeFileName_(buildEventLabel_(settings));
  var fileName = '候補_' + label + '_' + type + '_' + timestamp;

  var exportSs = SpreadsheetApp.create(fileName);
  var target = exportSs.getSheets()[0];
  target.setName('Export');

  if (type === 'waitlist' || type === 'full') {
    copySheetData_(ss.getSheetByName(CONFIG.SHEETS.WAITLIST), exportSs, 'Waitlist');
  }
  if (type === 'lottery' || type === 'full') {
    copySheetData_(ss.getSheetByName(CONFIG.SHEETS.LOTTERY_RESULT), exportSs, 'LotteryResult');
    copySheetData_(ss.getSheetByName(CONFIG.SHEETS.PUBLISH_BATCHES), exportSs, 'PublishBatches');
  }
  if (type === 'full') {
    copySheetData_(ss.getSheetByName(CONFIG.SHEETS.SETTINGS), exportSs, 'Settings');
    copySheetData_(ss.getSheetByName(CONFIG.SHEETS.AUDIT_LOG), exportSs, 'AuditLog');
  }

  exportSs.deleteSheet(target);
  appendAuditLog_('EXPORT', { type: type, file_id: exportSs.getId() });

  return success_({
    spreadsheet_id: exportSs.getId(),
    spreadsheet_url: exportSs.getUrl(),
    type: type
  });
}

function copySheetData_(sourceSheet, targetSpreadsheet, name) {
  if (!sourceSheet) return;
  var copied = sourceSheet.copyTo(targetSpreadsheet);
  copied.setName(name);
}

function clearEventData_() {
  return archiveEvent_();
}
