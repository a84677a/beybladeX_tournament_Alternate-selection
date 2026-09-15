function getWaitlistSheet_() {
  return getSpreadsheet_().getSheetByName(CONFIG.SHEETS.WAITLIST);
}

function getAllWaitlistRows_() {
  var sheet = getWaitlistSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    rows.push(rowToObject_(headers, values[i]));
  }
  return rows.filter(function (row) {
    return row.status !== 'cancelled';
  });
}

function rowToObject_(headers, row) {
  var obj = {};
  headers.forEach(function (header, idx) {
    obj[header] = row[idx];
  });
  return obj;
}

function findByRequestId_(requestId) {
  if (!requestId) return null;
  return getAllWaitlistRows_().find(function (row) {
    return row.request_id === requestId;
  }) || null;
}

function findByReceiptToken_(receiptToken) {
  if (!receiptToken) return null;
  return getAllWaitlistRows_().find(function (row) {
    return row.receipt_token === receiptToken;
  }) || null;
}

function findExactDuplicate_(normalizedName, normalizedPhone) {
  return getAllWaitlistRows_().find(function (row) {
    return row.normalized_name === normalizedName &&
      row.normalized_phone === normalizedPhone &&
      row.status === 'active';
  }) || null;
}

function findDuplicateFlags_(normalizedName, normalizedPhone) {
  var flags = [];
  var rows = getAllWaitlistRows_();
  var samePhone = rows.some(function (row) {
    return row.normalized_phone === normalizedPhone &&
      row.normalized_name !== normalizedName;
  });
  var sameName = rows.some(function (row) {
    return row.normalized_name === normalizedName &&
      row.normalized_phone !== normalizedPhone;
  });
  if (samePhone) flags.push('same_phone');
  if (sameName) flags.push('same_name');
  return flags;
}

function insertWaitlistRow_(row) {
  var sheet = getWaitlistSheet_();
  var headers = WAITLIST_HEADERS;
  var values = headers.map(function (header) {
    return row[header] !== undefined ? row[header] : '';
  });
  sheet.appendRow(values);
  invalidateWaitlistCountCache_();
  return row;
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
    cache.put(cacheKey, '0', 5);
    return 0;
  }

  var statusCol = WAITLIST_HEADERS.indexOf('status') + 1;
  var statuses = sheet.getRange(2, statusCol, lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < statuses.length; i++) {
    if (statuses[i][0] === 'active') count++;
  }
  cache.put(cacheKey, String(count), 5);
  return count;
}

function invalidateWaitlistCountCache_() {
  CacheService.getScriptCache().remove(CONFIG.CACHE_PREFIX + 'waitlist_count');
}

function toPublicWaitlistRow_(row) {
  return {
    waitlist_no: formatWaitlistNo_(row.waitlist_no),
    waitlist_no_raw: row.waitlist_no,
    name: row.name,
    phone_masked: maskPhone_(row.phone),
    registered_at: row.registered_at,
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
