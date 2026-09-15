function runInitialLottery_(firstBatchCount, advancedRules) {
  requireAdmin_();
  var settings = getAllSettings_();

  if (settings.lottery_locked) {
    return error_('LOTTERY_LOCKED', '抽選已完成，無法重新抽選');
  }

  var waitlist = getAllWaitlistRows_().filter(function (row) {
    return row.status === 'active';
  });
  if (waitlist.length === 0) {
    return error_('NO_CANDIDATES', '沒有可抽選的候補人員');
  }

  firstBatchCount = Number(firstBatchCount) || Number(settings.lottery_first_batch_count) || waitlist.length;
  if (firstBatchCount < 1) {
    return error_('INVALID_BATCH_COUNT', '首輪公布人數必須大於 0');
  }

  advancedRules = advancedRules || {};
  var excluded = (advancedRules.exclude || []).map(Number);
  var forced = (advancedRules.include || []).map(Number);

  var pool = waitlist.filter(function (row) {
    return excluded.indexOf(Number(row.waitlist_no)) === -1;
  });

  var shuffled = fisherYatesShuffle_(pool.map(function (row) {
    return Number(row.waitlist_no);
  }));

  forced.forEach(function (waitlistNo) {
    var idx = shuffled.indexOf(waitlistNo);
    if (idx > -1) shuffled.splice(idx, 1);
    if (firstBatchCount > 0) {
      var insertAt = Math.min(firstBatchCount - 1, shuffled.length);
      shuffled.splice(insertAt, 0, waitlistNo);
    } else {
      shuffled.unshift(waitlistNo);
    }
  });

  var lotteryId = Utilities.getUuid();
  var sheet = getLotteryResultSheet_();
  var rows = shuffled.map(function (waitlistNo, index) {
    return [
      lotteryId,
      settings.event_id,
      waitlistNo,
      index + 1,
      index < firstBatchCount,
      index < firstBatchCount ? 'pending' : ''
    ];
  });
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length + 1, LOTTERY_RESULT_HEADERS.length).setValues(rows);
  }

  var batchResult = createPublishBatch_(firstBatchCount, lotteryId, 1, '候補抽選結果');
  setSettings_({
    lottery_id: lotteryId,
    lottery_status: 'COMPLETED',
    lottery_locked: true,
    display_mode: 'LOTTERY_RESULT',
    active_batch_id: batchResult.data.batch_id
  });

  appendLotteryAudit_('INITIAL_LOTTERY', {
    lottery_id: lotteryId,
    total: shuffled.length,
    first_batch_count: firstBatchCount,
    advanced_rules: advancedRules
  });

  return success_({
    lottery_id: lotteryId,
    total: shuffled.length,
    first_batch: batchResult.data
  });
}

function createPublishBatch_(count, lotteryId, batchNo, displayTitle) {
  lotteryId = lotteryId || getSetting_('lottery_id', '');
  var results = getLotteryResults_().filter(function (row) {
    return row.lottery_id === lotteryId;
  }).sort(function (a, b) {
    return Number(a.random_rank) - Number(b.random_rank);
  });

  if (results.length === 0) {
    return error_('NO_LOTTERY', '尚未建立抽選結果');
  }

  var existingBatches = getPublishBatches_().filter(function (batch) {
    return batch.lottery_id === lotteryId;
  });
  var lastEnd = 0;
  if (existingBatches.length > 0) {
    lastEnd = Math.max.apply(null, existingBatches.map(function (batch) {
      return Number(batch.rank_end);
    }));
  }

  count = Number(count);
  var rankStart = lastEnd + 1;
  var rankEnd = rankStart + count - 1;
  if (rankEnd > results.length) {
    return error_('INVALID_BATCH_RANGE', '追加人數超出剩餘候補人數');
  }

  batchNo = batchNo || existingBatches.length + 1;
  displayTitle = displayTitle || (batchNo === 1 ? '候補抽選結果' : '第' + toChineseOrdinal_(batchNo) + '次候補抽選結果');

  var batchId = Utilities.getUuid();
  var sheet = getPublishBatchSheet_();
  sheet.appendRow([
    batchId,
    lotteryId,
    batchNo,
    rankStart,
    rankEnd,
    count,
    new Date(),
    displayTitle
  ]);

  var lotterySheet = getLotteryResultSheet_();
  var allValues = lotterySheet.getDataRange().getValues();
  for (var i = 1; i < allValues.length; i++) {
    var rank = Number(allValues[i][3]);
    if (allValues[i][0] === lotteryId && rank >= rankStart && rank <= rankEnd) {
      lotterySheet.getRange(i + 1, 5, 1, 2).setValues([[true, batchId]]);
    }
  }

  setSettings_({
    display_mode: 'LOTTERY_RESULT',
    active_batch_id: batchId
  });

  appendLotteryAudit_('PUBLISH_BATCH', {
    batch_id: batchId,
    batch_no: batchNo,
    rank_start: rankStart,
    rank_end: rankEnd,
    count: count
  });

  return success_({
    batch_id: batchId,
    batch_no: batchNo,
    rank_start: rankStart,
    rank_end: rankEnd,
    count: count,
    display_title: displayTitle
  });
}

function setDisplayedBatch_(batchId) {
  requireAdmin_();
  var batch = getBatchById_(batchId);
  if (!batch) {
    return error_('NOT_FOUND', '找不到公布批次');
  }
  setSettings_({
    display_mode: 'LOTTERY_RESULT',
    active_batch_id: batchId
  });
  appendAuditLog_('SET_DISPLAY_BATCH', { batch_id: batchId });
  return success_(batch);
}

function toChineseOrdinal_(num) {
  var map = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return map[num] || String(num);
}
