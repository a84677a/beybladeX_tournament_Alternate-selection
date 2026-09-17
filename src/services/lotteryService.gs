function normalizeWaitlistNoList_(list) {
  var seen = {};
  var result = [];
  (list || []).forEach(function (n) {
    n = Number(n);
    if (!n || isNaN(n) || n < 1 || seen[n]) return;
    seen[n] = true;
    result.push(n);
  });
  return result;
}

function validateAdvancedLotteryRules_(waitlist, firstBatchCount, advancedRules) {
  advancedRules = advancedRules || {};
  var excluded = normalizeWaitlistNoList_(advancedRules.exclude);
  var forced = normalizeWaitlistNoList_(advancedRules.include);
  var activeNos = waitlist.map(function (row) {
    return Number(row.waitlist_no);
  });

  var invalid = excluded.concat(forced).filter(function (no, index, arr) {
    return activeNos.indexOf(no) === -1 && arr.indexOf(no) === index;
  });
  if (invalid.length) {
    return error_(
      'INVALID_WAITLIST_NO',
      '以下序號不存在或非有效候補：' + invalid.map(formatWaitlistNo_).join(', ')
    );
  }

  var overlap = forced.filter(function (n) {
    return excluded.indexOf(n) !== -1;
  });
  if (overlap.length) {
    return error_(
      'RULE_CONFLICT',
      '以下序號不可同時排除又必中：' + overlap.map(formatWaitlistNo_).join(', ')
    );
  }

  if (forced.length > firstBatchCount) {
    return error_(
      'TOO_MANY_FORCED',
      '必中首輪人數（' + forced.length + '）不可超過首輪公布人數（' + firstBatchCount + '）'
    );
  }

  var poolSize = waitlist.length - excluded.length;
  if (poolSize < 1) {
    return error_('EMPTY_POOL', '排除後沒有可抽選的候補人員');
  }

  if (firstBatchCount > poolSize) {
    return error_(
      'INVALID_BATCH_COUNT',
      '首輪公布人數不可超過可抽選人數（' + poolSize + '）'
    );
  }

  return success_({
    excluded: excluded,
    forced: forced
  });
}

function applyForcedIncludes_(shuffled, forced, firstBatchCount) {
  forced.forEach(function (waitlistNo) {
    var idx = shuffled.indexOf(waitlistNo);
    if (idx > -1) shuffled.splice(idx, 1);
  });

  if (forced.length === 0) return shuffled;

  var fillCount = Math.min(Math.max(firstBatchCount - forced.length, 0), shuffled.length);
  var batchFill = shuffled.splice(0, fillCount);
  var batchSize = batchFill.length + forced.length;

  var slotIndices = [];
  for (var i = 0; i < batchSize; i++) slotIndices.push(i);
  var chosenSlots = fisherYatesShuffle_(slotIndices).slice(0, forced.length);
  chosenSlots.sort(function (a, b) { return a - b; });

  var result = [];
  var fillIdx = 0;
  var forcedIdx = 0;
  for (var k = 0; k < batchSize; k++) {
    if (forcedIdx < chosenSlots.length && chosenSlots[forcedIdx] === k) {
      result.push(forced[forcedIdx++]);
    } else {
      result.push(batchFill[fillIdx++]);
    }
  }

  return result.concat(shuffled);
}

function resolveDisplayModeAfterVoid_(settings) {
  if (settings.registration_enabled) {
    return settings.qr_visible ? 'OPEN' : 'PROCESSING';
  }
  return 'CLOSED';
}

function runInitialLottery_(firstBatchCount, advancedRules) {
  requireAdmin_();
  var settings = getAllSettings_();

  if (settings.lottery_locked) {
    return error_('LOTTERY_LOCKED', '抽選已完成，無法重新抽選');
  }

  var waitlist = getAllWaitlistRows_().filter(isWaitlistLotteryEligible_);
  if (waitlist.length === 0) {
    return error_('NO_CANDIDATES', '沒有可抽選的候補人員');
  }

  firstBatchCount = Number(firstBatchCount) || Number(settings.lottery_first_batch_count) || waitlist.length;
  if (firstBatchCount < 1) {
    return error_('INVALID_BATCH_COUNT', '首輪公布人數必須大於 0');
  }

  var rulesResult = validateAdvancedLotteryRules_(waitlist, firstBatchCount, advancedRules);
  if (!rulesResult.ok) return rulesResult;

  var excluded = rulesResult.data.excluded;
  var forced = rulesResult.data.forced;

  var pool = waitlist.filter(function (row) {
    return excluded.indexOf(Number(row.waitlist_no)) === -1;
  });

  var shuffled = fisherYatesShuffle_(pool.map(function (row) {
    return Number(row.waitlist_no);
  }));
  shuffled = applyForcedIncludes_(shuffled, forced, firstBatchCount);

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
  if (!batchResult.ok) return batchResult;

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
    advanced_rules: { exclude: excluded, include: forced }
  });

  return success_({
    lottery_id: lotteryId,
    total: shuffled.length,
    first_batch: batchResult.data
  });
}

function voidLottery_(reason) {
  requireAdmin_();
  reason = String(reason || '').trim();
  if (!reason) {
    return error_('REASON_REQUIRED', '請填寫作廢原因');
  }

  return withScriptLock_(function () {
    var settings = getAllSettings_();
    if (!settings.lottery_locked || !settings.lottery_id) {
      return error_('NO_LOTTERY', '目前沒有可作廢的抽選結果');
    }

    var voidedLotteryId = settings.lottery_id;
    appendLotteryAudit_('VOID_LOTTERY', {
      lottery_id: voidedLotteryId,
      reason: reason,
      event_id: settings.event_id
    });

    clearLotteryResultSheets_();
    setSettings_({
      lottery_id: '',
      lottery_status: 'NONE',
      lottery_locked: false,
      active_batch_id: '',
      display_mode: resolveDisplayModeAfterVoid_(settings)
    });

    appendAuditLog_('VOID_LOTTERY', {
      lottery_id: voidedLotteryId,
      reason: reason
    });

    return success_({
      voided_lottery_id: voidedLotteryId,
      message: '抽選已作廢，可重新設定進階規則並執行首次抽選'
    });
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
