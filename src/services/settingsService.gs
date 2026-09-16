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

function buildPublicStateBody_(settings) {
  var hasActiveEvent = settings.event_status === 'ACTIVE';

  var state = {
    has_active_event: hasActiveEvent,
    event_id: settings.event_id,
    event_name: hasActiveEvent ? (settings.event_name || '') : '',
    session_name: hasActiveEvent ? (settings.session_name || '') : '',
    registration_enabled: hasActiveEvent && !!settings.registration_enabled,
    qr_visible: hasActiveEvent && !!settings.qr_visible,
    display_mode: hasActiveEvent ? (settings.display_mode || 'CLOSED') : 'CLOSED',
    deadline: settings.deadline || '',
    show_deadline: !!settings.show_deadline,
    mode: settings.mode || CONFIG.DEFAULTS.MODE,
    show_qr_countdown: !!settings.show_qr_countdown,
    display_title: settings.display_title || '',
    display_subtitle: settings.display_subtitle || '',
    lottery_status: settings.lottery_status || 'NONE',
    active_batch_id: settings.active_batch_id || ''
  };

  if (state.display_mode === 'LOTTERY_RESULT' && settings.active_batch_id) {
    state.lottery_display = buildLotteryDisplay_(settings);
  }

  return state;
}

function attachVolatilePublicFields_(state, settings) {
  var qr = buildQrToken_(settings);
  var candidateUrl = getCandidateUrl_();

  state.waitlist_count = countActiveWaitlist_();
  state.qr = {
    url: candidateUrl + '&token=' + encodeURIComponent(qr.token),
    token: qr.token,
    rotation_enabled: qr.rotation_enabled,
    interval: qr.interval,
    expires_at: qr.expires_at
  };

  return state;
}

function getPublicState_() {
  var settings = getAllSettings_();
  var cache = CacheService.getScriptCache();
  var cacheKey = CONFIG.CACHE_PREFIX + 'public_state';
  var cached = cache.get(cacheKey);
  var state;

  if (cached) {
    state = JSON.parse(cached);
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

function getAdminDashboard_() {
  requireAdmin_();
  var settings = getAllSettings_();
  var waitlist = getAllWaitlistRows_().map(toPublicWaitlistRow_);
  var batches = getPublishBatches_();

  return success_({
    settings: settings,
    has_active_event: settings.event_status === 'ACTIVE',
    event_label: buildEventLabel_(settings),
    waitlist: waitlist,
    waitlist_count: waitlist.length,
    publish_batches: batches,
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
