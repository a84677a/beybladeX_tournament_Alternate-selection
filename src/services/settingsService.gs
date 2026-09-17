function getDeadlineDate_(settings) {
  if (!settings || !settings.deadline) return null;

  var date = new Date(settings.deadline);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatDeadlineForDisplay_(settings) {
  var date = getDeadlineDate_(settings);
  if (!date) return '';

  var tz = 'Asia/Taipei';

  return Utilities.formatDate(
    date,
    tz,
    'HH:mm'
  );
}

function applyAutoCloseDeadline_(settings) {
  if (!settings) return settings;

  if (!settings.auto_close_deadline) {
    return settings;
  }

  if (!settings.registration_enabled) {
    return settings;
  }

  var deadline = getDeadlineDate_(settings);

  if (!deadline) {
    return settings;
  }

  var now = new Date();

  if (now.getTime() < deadline.getTime()) {
    return settings;
  }

  try {
    return withScriptLock_(function () {
      // 取得 Lock 後重新讀取，避免使用其他 request 的舊狀態
      var latestSettings = getAllSettings_();

      // 可能已經被另一個 request 關閉
      if (!latestSettings.auto_close_deadline ||
          !latestSettings.registration_enabled) {
        return latestSettings;
      }

      var latestDeadline =
        getDeadlineDate_(latestSettings);

      if (!latestDeadline) {
        return latestSettings;
      }

      var latestNow = new Date();

      if (latestNow.getTime() < latestDeadline.getTime()) {
        return latestSettings;
      }

      // 只有第一個成功進入這裡的 request 會真正執行關閉
      setSettings_({
        registration_enabled: false,
        qr_visible: false,
        display_mode: 'CLOSED'
      });

      invalidatePublicStateCache_();

      appendAuditLog_('AUTO_CLOSE_DEADLINE', {
        deadline: latestSettings.deadline,
        closed_at: latestNow.toISOString()
      });

      return getAllSettings_();
    });

  } catch (err) {
    // 若其他 request 正在執行自動關閉，
    // 不讓 Display / Candidate 因為搶不到 Lock 直接報錯
    if (err && err.code === 'BUSY') {
      invalidateSettingsCache_();
      return getAllSettings_();
    }

    throw err;
  }
}

function invalidatePublicStateCache_() {
  CacheService.getScriptCache().remove(CONFIG.CACHE_PREFIX + 'public_state');
}

function invalidateLotteryDisplayCache_(batchId) {
  if (!batchId) return;
  CacheService.getScriptCache().remove(CONFIG.CACHE_PREFIX + 'lottery_display_' + batchId);
}

function getPublicStateCacheTtl_(settings) {
  if (settings.display_mode === 'LOTTERY_RESULT') {
    return CONFIG.CACHE_TTL.LOTTERY_DISPLAY;
  }
  return CONFIG.CACHE_TTL.PUBLIC_STATE;
}

function syncPublicStateFromSettings_(state, settings) {
  state = state || {};
  var hasActiveEvent = settings.event_status === 'ACTIVE';

  state.has_active_event = hasActiveEvent;
  state.event_id = settings.event_id;
  state.event_name = hasActiveEvent ? (settings.event_name || '') : '';
  state.session_name = hasActiveEvent ? (settings.session_name || '') : '';
  state.registration_enabled = hasActiveEvent && !!settings.registration_enabled;
  state.qr_visible = hasActiveEvent && !!settings.qr_visible;
  state.display_mode = hasActiveEvent ? (settings.display_mode || 'CLOSED') : 'CLOSED';
  state.deadline = formatDeadlineForDisplay_(settings);
  state.show_deadline = !!settings.show_deadline;
  state.show_waitlist_count = !!settings.show_waitlist_count;
  state.mode = settings.mode || CONFIG.DEFAULTS.MODE;
  state.show_qr_countdown = !!settings.show_qr_countdown;
  state.display_title = settings.display_title || '';
  state.display_subtitle = settings.display_subtitle || '';
  state.lottery_status = settings.lottery_status || 'NONE';
  state.active_batch_id = settings.active_batch_id || '';

  if (state.display_mode === 'LOTTERY_RESULT' && settings.active_batch_id) {
    state.lottery_display = buildLotteryDisplay_(settings);
  } else {
    delete state.lottery_display;
  }

  return state;
}

function buildPublicStateBody_(settings) {
  return syncPublicStateFromSettings_({}, settings);
}

function attachVolatilePublicFields_(state, settings) {
  var hasActiveEvent = settings.event_status === 'ACTIVE';
  var showQr = hasActiveEvent &&
    !!settings.registration_enabled &&
    !!settings.qr_visible;

  state.waitlist_count = countActiveWaitlist_();

  if (showQr) {
    var qr = buildQrToken_(settings);
    var candidateUrl = getCandidateUrl_();
    state.qr = {
      url: candidateUrl + '&token=' + encodeURIComponent(qr.token),
      token: qr.token,
      rotation_enabled: qr.rotation_enabled,
      interval: qr.interval,
      expires_at: qr.expires_at
    };
  } else {
    state.qr = {
      url: '',
      token: '',
      rotation_enabled: false,
      interval: 0,
      expires_at: 0
    };
  }

  return state;
}

function getPublicState_() {
  var settings = getAllSettings_();

  settings = applyAutoCloseDeadline_(settings);
  var cache = CacheService.getScriptCache();
  var cacheKey = CONFIG.CACHE_PREFIX + 'public_state';
  var cached = cache.get(cacheKey);
  var state;

  if (cached) {
    // 快取命中時仍須同步最新 settings，避免自動截止後狀態滞後
    state = syncPublicStateFromSettings_(JSON.parse(cached), settings);
  } else {
    state = buildPublicStateBody_(settings);
    cache.put(cacheKey, JSON.stringify(state), getPublicStateCacheTtl_(settings));
  }

  attachVolatilePublicFields_(state, settings);
  return success_(state);
}

function buildLotteryDisplay_(settings) {
  var batchId = settings.active_batch_id;
  if (!batchId) return null;

  var cacheKey = CONFIG.CACHE_PREFIX + 'lottery_display_' + batchId;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  var batch = getBatchById_(batchId);
  if (!batch) return null;

  var results = getBatchResults_(batch);
  var entries = results.map(function (result) {
    return {
      waitlist_no: formatWaitlistNo_(result.waitlist_no),
      random_rank: Number(result.random_rank)
    };
  });

  if (settings.lottery_sort_asc) {
    entries.sort(function (a, b) {
      return Number(a.waitlist_no.replace('#', '')) - Number(b.waitlist_no.replace('#', ''));
    });
  }

  var display = {
    batch_id: batch.batch_id,
    batch_no: batch.batch_no,
    display_title: batch.display_title || settings.display_title || '候補抽選結果',
    entries: entries,
    numbers: entries.map(function (entry) {
      return entry.waitlist_no;
    }),
    results_per_page: Number(settings.results_per_page) || CONFIG.DEFAULTS.RESULTS_PER_PAGE,
    results_columns: Number(settings.results_columns) || 0,
    carousel_seconds: Number(settings.carousel_seconds) || CONFIG.DEFAULTS.DISPLAY_CAROUSEL_SECONDS,
    show_page_number: !!settings.show_page_number,
    show_random_rank: !!settings.show_random_rank
  };

  cache.put(cacheKey, JSON.stringify(display), CONFIG.CACHE_TTL.LOTTERY_DISPLAY);
  return display;
}

function isPublishedFlag_(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

function buildAdminPublishedLottery_(settings) {
  if (!settings || !settings.lottery_id) {
    return { batches: [], entries: [] };
  }

  var lotteryId = settings.lottery_id;
  var batches = getPublishBatches_().filter(function (batch) {
    return batch.lottery_id === lotteryId;
  }).map(function (batch) {
    return {
      batch_id: batch.batch_id,
      batch_no: Number(batch.batch_no),
      display_title: batch.display_title || '',
      rank_start: Number(batch.rank_start),
      rank_end: Number(batch.rank_end),
      count: Number(batch.count)
    };
  });

  var waitlistByNo = {};
  getAllWaitlistRows_().forEach(function (row) {
    waitlistByNo[Number(row.waitlist_no)] = row;
  });

  var batchById = {};
  batches.forEach(function (batch) {
    batchById[batch.batch_id] = batch;
  });

  var entries = getLotteryResults_().filter(function (row) {
    return row.lottery_id === lotteryId && isPublishedFlag_(row.is_published);
  }).map(function (row) {
    var waitlistNo = Number(row.waitlist_no);
    var waitlistRow = waitlistByNo[waitlistNo] || {};
    var batch = batchById[row.published_batch_id] || null;
    return {
      waitlist_no: formatWaitlistNo_(waitlistNo),
      waitlist_no_raw: waitlistNo,
      random_rank: Number(row.random_rank),
      batch_id: row.published_batch_id || '',
      batch_no: batch ? batch.batch_no : '',
      batch_title: batch ? batch.display_title : '',
      name: waitlistRow.name || '',
      phone_masked: maskPhone_(waitlistRow.phone),
      registered_at: waitlistRow.registered_at || ''
    };
  }).sort(function (a, b) {
    return a.random_rank - b.random_rank;
  });

  return {
    batches: batches,
    entries: entries
  };
}

function getAdminDashboard_() {
  requireAdmin_();

  var settings =
    applyAutoCloseDeadline_(getAllSettings_());
  var waitlist = getAllWaitlistRows_().map(toPublicWaitlistRow_);
  var batches = getPublishBatches_();
  var publishedLottery = buildAdminPublishedLottery_(settings);

  return success_({
    settings: settings,
    default_staff_pin: CONFIG.DEFAULTS.DEFAULT_STAFF_PIN,
    default_event_name: CONFIG.DEFAULTS.DEFAULT_EVENT_NAME,
    default_session_name: CONFIG.DEFAULTS.DEFAULT_SESSION_NAME,
    has_active_event: settings.event_status === 'ACTIVE',
    event_label: buildEventLabel_(settings),
    waitlist: waitlist,
    waitlist_count: waitlist.length,
    publish_batches: batches,
    published_lottery: publishedLottery,
    urls: {
      display: getDisplayUrl_(),
      candidate: getCandidateUrl_(),
      admin: ScriptApp.getService().getUrl() + '?page=admin'
    }
  });
}

function setRegistrationState_(enabled) {
  requireAdmin_();
  setSetting_('registration_enabled', !!enabled);
  appendAuditLog_('SET_REGISTRATION', { enabled: !!enabled });
  return success_(getAllSettings_());
}

function setQrVisible_(visible) {
  requireAdmin_();
  setSetting_('qr_visible', !!visible);
  appendAuditLog_('SET_QR_VISIBLE', { visible: !!visible });
  return success_(getAllSettings_());
}

function setQuickState_(state) {
  requireAdmin_();
  var updates = applyQuickState_(state);
  appendAuditLog_('QUICK_STATE', { state: state, updates: updates });
  return success_(getAllSettings_());
}

function updateSettings_(updates) {
  requireAdmin_();
  updates = updates || {};

  if (updates.staff_pin) {
    updates.staff_pin_hash = hashPin_(String(updates.staff_pin), getScriptSecret_());
    delete updates.staff_pin;
  }

  setSettings_(updates);
  appendAuditLog_('UPDATE_SETTINGS', updates);
  return success_(getAllSettings_());
}
