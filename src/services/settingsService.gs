function getPublicState_() {
  var settings = getAllSettings_();
  var hasActiveEvent = settings.event_status === 'ACTIVE';
  var qr = buildQrToken_(settings);
  var candidateUrl = getCandidateUrl_();
  var qrUrl = candidateUrl + '&token=' + encodeURIComponent(qr.token);

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
    waitlist_count: countActiveWaitlist_(),
    qr: {
      url: qrUrl,
      token: qr.token,
      rotation_enabled: qr.rotation_enabled,
      interval: qr.interval,
      expires_at: qr.expires_at
    },
    show_qr_countdown: !!settings.show_qr_countdown,
    display_title: settings.display_title || '',
    display_subtitle: settings.display_subtitle || '',
    lottery_status: settings.lottery_status || 'NONE',
    active_batch_id: settings.active_batch_id || ''
  };

  if (state.display_mode === 'LOTTERY_RESULT' && settings.active_batch_id) {
    state.lottery_display = buildLotteryDisplay_(settings);
  }

  return success_(state);
}

function buildLotteryDisplay_(settings) {
  var batch = getBatchById_(settings.active_batch_id);
  if (!batch) return null;

  var results = getBatchResults_(batch);
  var waitlistMap = {};
  getAllWaitlistRows_().forEach(function (row) {
    waitlistMap[row.waitlist_no] = row;
  });

  var numbers = results.map(function (result) {
    return formatWaitlistNo_(result.waitlist_no);
  });

  if (settings.lottery_sort_asc) {
    numbers.sort(function (a, b) {
      return Number(a.replace('#', '')) - Number(b.replace('#', ''));
    });
  }

  return {
    batch_id: batch.batch_id,
    batch_no: batch.batch_no,
    display_title: batch.display_title || settings.display_title || '候補抽選結果',
    numbers: numbers,
    results_per_page: Number(settings.results_per_page) || CONFIG.DEFAULTS.RESULTS_PER_PAGE,
    carousel_seconds: Number(settings.carousel_seconds) || CONFIG.DEFAULTS.DISPLAY_CAROUSEL_SECONDS,
    show_page_number: !!settings.show_page_number,
    show_random_rank: !!settings.show_random_rank
  };
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
