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
    if (row.status !== 'active') return;
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
  var index = buildWaitlistIndexFromRows_(getAllWaitlistRows_());
  CacheService.getScriptCache().put(
    getWaitlistIndexCacheKey_(),
    JSON.stringify(index),
    CONFIG.CACHE_TTL.WAITLIST_INDEX
  );
  return index;
}

function getWaitlistIndex_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(getWaitlistIndexCacheKey_());
  if (cached) {
    return JSON.parse(cached);
  }
  return rebuildWaitlistIndex_();
}

function appendWaitlistIndexEntry_(row) {
  var cache = CacheService.getScriptCache();
  var cacheKey = getWaitlistIndexCacheKey_();
  var raw = cache.get(cacheKey);
  if (!raw) {
    rebuildWaitlistIndex_();
    return;
  }

  var index = JSON.parse(raw);
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

  cache.put(cacheKey, JSON.stringify(index), CONFIG.CACHE_TTL.WAITLIST_INDEX);
}

function invalidateWaitlistIndex_() {
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
    if (statuses[i][0] === 'active') count++;
  }
  cache.put(cacheKey, String(count), CONFIG.CACHE_TTL.WAITLIST_COUNT);
  return count;
}

function invalidateWaitlistCountCache_() {
  CacheService.getScriptCache().remove(CONFIG.CACHE_PREFIX + 'waitlist_count');
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
