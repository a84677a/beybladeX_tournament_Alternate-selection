function getWaitlistSheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.SHEETS.WAITLIST);
}

var _waitlistIndexMemory_ = null;

function getAllWaitlistRows_() {
  var sheet = getWaitlistSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, WAITLIST_HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    rows.push(rowToObject_(WAITLIST_HEADERS, values[i]));
  }
  return rows.filter(function (row) {
    return row.status !== 'cancelled';
  });
}

function readWaitlistRowsForIndex_() {
  var sheet = getWaitlistSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, WAITLIST_HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = rowToObject_(WAITLIST_HEADERS, values[i]);
    if (isWaitlistIndexed_(row)) {
      rows.push(row);
    }
  }
  return rows;
}

function isWaitlistIndexed_(row) {
  return row.status === 'active' || row.status === 'excluded';
}

function isWaitlistLotteryEligible_(row) {
  return row.status === 'active';
}

function isWaitlistPublicCounted_(row) {
  return row.status === 'active' || row.status === 'excluded';
}

function rowToObject_(headers, row) {
  var obj = {};
  headers.forEach(function (header, idx) {
    obj[header] = row[idx];
  });
  return obj;
}

function getWaitlistIndexCacheKey_() {
  return CONFIG.CACHE_PREFIX + 'waitlist_index';
}

function toIndexRow_(row) {
  var normalizedName = normalizeName_(row.normalized_name || row.name);
  var normalizedPhone = normalizePhone_(row.normalized_phone || row.phone);
  return {
    event_id: row.event_id,
    waitlist_no: row.waitlist_no,
    name: row.name,
    phone: normalizedPhone || row.phone,
    normalized_name: normalizedName,
    normalized_phone: normalizedPhone,
    registered_at: row.registered_at,
    request_id: row.request_id,
    receipt_token: row.receipt_token,
    duplicate_flags: row.duplicate_flags,
    status: row.status
  };
}

function buildWaitlistIndexFromRows_(rows) {
  var index = {
    by_request: {},
    by_receipt: {},
    by_exact: {},
    phones: {},
    names: {}
  };

  rows.forEach(function (row) {
    if (!isWaitlistIndexed_(row)) return;
    var compact = toIndexRow_(row);

    if (compact.request_id) {
      index.by_request[compact.request_id] = compact;
    }
    if (compact.receipt_token) {
      index.by_receipt[compact.receipt_token] = compact;
    }

    var exactKey = compact.normalized_name + '|' + compact.normalized_phone;
    index.by_exact[exactKey] = compact;

    if (!index.phones[compact.normalized_phone]) {
      index.phones[compact.normalized_phone] = [];
    }
    index.phones[compact.normalized_phone].push(compact);

    if (!index.names[compact.normalized_name]) {
      index.names[compact.normalized_name] = [];
    }
    index.names[compact.normalized_name].push(compact);
  });

  return index;
}

function rebuildWaitlistIndex_() {
  return buildWaitlistIndexFromRows_(readWaitlistRowsForIndex_());
}

function getWaitlistIndex_() {
  if (_waitlistIndexMemory_) {
    return _waitlistIndexMemory_;
  }
  _waitlistIndexMemory_ = rebuildWaitlistIndex_();
  return _waitlistIndexMemory_;
}

function appendWaitlistIndexEntry_(row) {
  // Waitlist index 不再整包存入 CacheService。
  // 查詢時直接依目前 Sheet 資料建立 index，
  // 避免候補人數增加後超過 CacheService 單筆 value 大小限制。
}

function invalidateWaitlistIndex_() {
  _waitlistIndexMemory_ = null;
  CacheService.getScriptCache().remove(getWaitlistIndexCacheKey_());
}

function lookupWaitlistForRegistration_(requestId, normalizedName, normalizedPhone) {
  var index = getWaitlistIndex_();
  var byRequestId = requestId ? (index.by_request[requestId] || null) : null;
  var exactDuplicate = null;
  var duplicateFlags = [];

  if (normalizedName && normalizedPhone) {
    exactDuplicate = index.by_exact[normalizedName + '|' + normalizedPhone] || null;

    var phoneRows = index.phones[normalizedPhone] || [];
    for (var i = 0; i < phoneRows.length; i++) {
      if (phoneRows[i].normalized_name !== normalizedName) {
        duplicateFlags.push('same_phone');
        break;
      }
    }

    var nameRows = index.names[normalizedName] || [];
    for (var j = 0; j < nameRows.length; j++) {
      if (nameRows[j].normalized_phone !== normalizedPhone) {
        duplicateFlags.push('same_name');
        break;
      }
    }
  }

  return {
    byRequestId: byRequestId,
    exactDuplicate: exactDuplicate,
    duplicateFlags: duplicateFlags
  };
}

function findByRequestId_(requestId) {
  if (!requestId) return null;
  var index = getWaitlistIndex_();
  return index.by_request[requestId] || null;
}

function findByReceiptToken_(receiptToken) {
  if (!receiptToken) return null;
  var index = getWaitlistIndex_();
  return index.by_receipt[receiptToken] || null;
}

function findExactDuplicate_(normalizedName, normalizedPhone) {
  var index = getWaitlistIndex_();
  return index.by_exact[normalizedName + '|' + normalizedPhone] || null;
}

function findDuplicateFlags_(normalizedName, normalizedPhone) {
  return lookupWaitlistForRegistration_(null, normalizedName, normalizedPhone).duplicateFlags;
}

function insertWaitlistRow_(row) {
  var sheet = getWaitlistSheet_();
  var headers = WAITLIST_HEADERS;
  var normalizedPhone = normalizePhone_(row.normalized_phone || row.phone);
  var storedRow = {
    event_id: row.event_id,
    waitlist_no: row.waitlist_no,
    name: row.name,
    phone: normalizedPhone,
    normalized_name: normalizeName_(row.normalized_name || row.name),
    normalized_phone: normalizedPhone,
    registered_at: row.registered_at,
    request_id: row.request_id,
    receipt_token: row.receipt_token,
    duplicate_flags: row.duplicate_flags,
    status: row.status
  };
  var values = headers.map(function (header) {
    var val = storedRow[header] !== undefined ? storedRow[header] : '';
    if (header === 'phone' || header === 'normalized_phone') {
      return formatPhoneForSheet_(val);
    }
    return val;
  });
  sheet.appendRow(values);
  invalidateWaitlistCountCache_();
  appendWaitlistIndexEntry_(storedRow);
  return storedRow;
}

function countActiveWaitlist_() {
  var cache = CacheService.getScriptCache();
  var cacheKey = CONFIG.CACHE_PREFIX + 'waitlist_count';
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return Number(cached);
  }

  var sheet = getWaitlistSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    cache.put(cacheKey, '0', CONFIG.CACHE_TTL.WAITLIST_COUNT);
    return 0;
  }

  var statusCol = WAITLIST_HEADERS.indexOf('status') + 1;
  var statuses = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < statuses.length; i++) {
    if (isWaitlistPublicCounted_({ status: statuses[i][0] })) count++;
  }
  cache.put(cacheKey, String(count), CONFIG.CACHE_TTL.WAITLIST_COUNT);
  return count;
}

function getWaitlistStatusCountsCacheKey_() {
  return CONFIG.CACHE_PREFIX + 'waitlist_status_counts';
}

function getWaitlistStatusCounts_() {
  var cache = CacheService.getScriptCache();
  var cacheKey = getWaitlistStatusCountsCacheKey_();
  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached);
  }

  var sheet = getWaitlistSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    var empty = { active: 0, excluded: 0 };
    cache.put(cacheKey, JSON.stringify(empty), CONFIG.CACHE_TTL.WAITLIST_COUNT);
    return empty;
  }

  var statusCol = WAITLIST_HEADERS.indexOf('status') + 1;
  var statuses = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
  var active = 0;
  var excluded = 0;
  for (var i = 0; i < statuses.length; i++) {
    var status = statuses[i][0];
    if (status === 'active') active++;
    else if (status === 'excluded') excluded++;
  }

  var counts = { active: active, excluded: excluded };
  cache.put(cacheKey, JSON.stringify(counts), CONFIG.CACHE_TTL.WAITLIST_COUNT);
  return counts;
}

function invalidateWaitlistCountCache_() {
  var cache = CacheService.getScriptCache();
  cache.remove(CONFIG.CACHE_PREFIX + 'waitlist_count');
  cache.remove(getWaitlistStatusCountsCacheKey_());
}

function findWaitlistSheetRow_(waitlistNo) {
  var sheet = getWaitlistSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  var waitlistNoCol = WAITLIST_HEADERS.indexOf('waitlist_no') + 1;
  var statusCol = WAITLIST_HEADERS.indexOf('status') + 1;
  var targetNo = Number(waitlistNo);
  var nos = sheet.getRange(2, waitlistNoCol, lastRow - 1, 1).getValues();

  for (var i = 0; i < nos.length; i++) {
    if (Number(nos[i][0]) === targetNo) {
      var rowIndex = i + 2;
      var rowValues = sheet.getRange(
        rowIndex,
        1,
        rowIndex,
        WAITLIST_HEADERS.length
      ).getValues()[0];
      return {
        rowIndex: rowIndex,
        statusCol: statusCol,
        row: rowToObject_(WAITLIST_HEADERS, rowValues)
      };
    }
  }
  return null;
}

function setWaitlistRowStatus_(waitlistNo, status) {
  var found = findWaitlistSheetRow_(waitlistNo);
  if (!found) return null;

  getWaitlistSheet_()
    .getRange(found.rowIndex, found.statusCol)
    .setValue(status);
  invalidateWaitlistIndex_();
  invalidateWaitlistCountCache_();
  return found.row;
}

function formatRegisteredAt_(value) {
  if (!value) return '';
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
}

function toPublicWaitlistRow_(row) {
  return {
    waitlist_no: formatWaitlistNo_(row.waitlist_no),
    waitlist_no_raw: row.waitlist_no,
    name: row.name,
    phone_masked: maskPhone_(row.phone),
    registered_at: formatRegisteredAt_(row.registered_at),
    duplicate_flags: row.duplicate_flags,
    status: row.status
  };
}

function toSuccessPayload_(row) {
  return {
    waitlist_no: formatWaitlistNo_(row.waitlist_no),
    waitlist_no_raw: row.waitlist_no,
    name: row.name,
    phone_masked: maskPhone_(row.phone),
    registered_at: row.registered_at,
    receipt_token: row.receipt_token
  };
}
