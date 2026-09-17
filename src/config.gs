/**
 * 候補系統設定常數
 * @see Waitlist_System_Specification_v1.0
 */

var CONFIG = {
  SHEETS: {
    SETTINGS: 'Settings',
    WAITLIST: 'Waitlist',
    LOTTERY_RESULT: 'LotteryResult',
    PUBLISH_BATCHES: 'PublishBatches',
    LOTTERY_AUDIT: 'LotteryAudit',
    AUDIT_LOG: 'AuditLog'
  },

  DEFAULTS: {
    MODE: 'general', // general | counter
    QR_ROTATION: true,
    QR_ROTATION_INTERVAL: 20,
    TOKEN_TTL: 40,
    FORM_SESSION_TTL: 70,
    /** 櫃檯 PIN 階段 Cache 上限（CacheService 最長 21600 秒） */
    PIN_SESSION_TTL: 21600,
    PIN_MAX_ATTEMPTS: 3,
    PIN_LOCKOUT_SECONDS: 30,
    DEFAULT_STAFF_PIN: '0313',
    DEFAULT_EVENT_NAME: '不累的盃',
    DEFAULT_SESSION_NAME: '候補測試賽',
    SHOW_DEADLINE: true,
    AUTO_CLOSE_DEADLINE: false,
    SHOW_WAITLIST_COUNT: false,

    DISPLAY_CAROUSEL_SECONDS: 5,
    LOTTERY_SORT_ASC: true,
    SHOW_RANDOM_RANK: false,
    RESULTS_PER_PAGE: 16
  },

  LOCK_TIMEOUT_MS: 30000,
  CACHE_PREFIX: 'waitlist_',
  CACHE_TTL: {
    SETTINGS: 15,
    WAITLIST_COUNT: 15,
    WAITLIST_INDEX: 15,
    PUBLIC_STATE: 8,
    LOTTERY_DISPLAY: 3600
  }
};

var SETTINGS_KEYS = [
  'event_id',
  'event_name',
  'session_name',
  'event_status',
  'registration_enabled',
  'qr_visible',
  'display_mode',
  'mode',
  'deadline',
  'show_deadline',
  'auto_close_deadline',
  'show_waitlist_count',
  'qr_rotation',
  'qr_rotation_interval',
  'token_ttl',
  'form_session_ttl',
  'staff_pin_hash',
  'pin_max_attempts',
  'pin_lockout_seconds',
  'waitlist_cap',
  'next_waitlist_number',
  'lottery_status',
  'lottery_locked',
  'active_batch_id',
  'display_title',
  'display_subtitle',
  'show_qr_countdown',
  'results_per_page',
  'results_columns',
  'carousel_seconds',
  'show_page_number',
  'lottery_sort_asc',
  'show_random_rank',
  'lottery_first_batch_count'
];

var WAITLIST_HEADERS = [
  'event_id',
  'waitlist_no',
  'name',
  'phone',
  'normalized_name',
  'normalized_phone',
  'registered_at',
  'request_id',
  'receipt_token',
  'duplicate_flags',
  'status'
];

var LOTTERY_RESULT_HEADERS = [
  'lottery_id',
  'event_id',
  'waitlist_no',
  'random_rank',
  'is_published',
  'published_batch_id'
];

var PUBLISH_BATCH_HEADERS = [
  'batch_id',
  'lottery_id',
  'batch_no',
  'rank_start',
  'rank_end',
  'count',
  'published_at',
  'display_title'
];

var LOTTERY_AUDIT_HEADERS = [
  'audit_id',
  'lottery_id',
  'event_id',
  'action',
  'details',
  'created_at',
  'created_by'
];

var AUDIT_LOG_HEADERS = [
  'log_id',
  'event_id',
  'action',
  'details',
  'created_at',
  'created_by'
];

function getSpreadsheetRaw_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('SPREADSHEET_ID 未設定。請在 Script Properties 設定試算表 ID。');
  }
  return SpreadsheetApp.openById(id);
}

function getSpreadsheet_() {
  var ss = getSpreadsheetRaw_();
  ensureWaitlistSystemInitialized_(ss);
  return ss;
}

function getScriptSecret_() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SERVER_SECRET');
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty('SERVER_SECRET', secret);
  }
  return secret;
}
