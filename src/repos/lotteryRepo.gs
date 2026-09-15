function getLotteryResultSheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.SHEETS.LOTTERY_RESULT);
}

function getPublishBatchSheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.SHEETS.PUBLISH_BATCHES);
}

function getLotteryResults_() {
  var sheet = getLotteryResultSheet_();
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    rows.push(rowToObject_(headers, values[i]));
  }
  return rows;
}

function getPublishBatches_() {
  var sheet = getPublishBatchSheet_();
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    rows.push(rowToObject_(headers, values[i]));
  }
  return rows.sort(function (a, b) {
    return Number(a.batch_no) - Number(b.batch_no);
  });
}

function getBatchById_(batchId) {
  return getPublishBatches_().find(function (batch) {
    return batch.batch_id === batchId;
  }) || null;
}

function getBatchResults_(batch) {
  if (!batch) return [];
  var results = getLotteryResults_();
  return results.filter(function (row) {
    var rank = Number(row.random_rank);
    return rank >= Number(batch.rank_start) && rank <= Number(batch.rank_end);
  });
}

function clearLotteryData_() {
  [CONFIG.SHEETS.LOTTERY_RESULT, CONFIG.SHEETS.PUBLISH_BATCHES, CONFIG.SHEETS.LOTTERY_AUDIT].forEach(function (name) {
    var sheet = getSpreadsheet_().getSheetByName(name);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  });
}
