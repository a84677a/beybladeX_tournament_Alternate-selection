function appendAuditLog_(action, details) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
  if (!sheet) return;

  var settings = getAllSettings_();
  var user = getCurrentAdminOperator_() || 'anonymous';

  sheet.appendRow([
    Utilities.getUuid(),
    settings.event_id || '',
    action,
    typeof details === 'string' ? details : JSON.stringify(details),
    new Date(),
    user
  ]);
}

function appendLotteryAudit_(action, details) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.LOTTERY_AUDIT);
  if (!sheet) return;

  var settings = getAllSettings_();
  var user = getCurrentAdminOperator_() || 'anonymous';

  sheet.appendRow([
    Utilities.getUuid(),
    settings.lottery_id || '',
    settings.event_id || '',
    action,
    typeof details === 'string' ? details : JSON.stringify(details),
    new Date(),
    user
  ]);
}
