function doGet(e) {
  e = e || {};
  var page = (e.parameter && e.parameter.page) || 'display';

  switch (page) {
    case 'candidate':
      return renderPage_('candidate', '候補登記');
    case 'admin':
      return renderPage_('admin', '候補系統管理');
    case 'display':
    default:
      return renderPage_('display', '候補登記 Display');
  }
}

function renderPage_(filename, title) {
  var template = HtmlService.createTemplateFromFile(filename);
  template.webAppUrl = getWebAppUrl();
  template.initialStateJson = 'null';
  if (filename === 'display') {
    try {
      var state = getPublicState_();
      template.initialStateJson = JSON.stringify(state.ok ? state.data : null);
    } catch (err) {
      Logger.log('display initial state failed: ' + (err.message || err));
    }
  }
  return template.evaluate()
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  e = e || {};
  var body = {};
  try {
    body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
  } catch (err) {
    return jsonResponse_(error_('INVALID_JSON', '無法解析請求內容'));
  }

  var action = body.action || (e.parameter && e.parameter.action);
  return routeAction_(action, body);
}

function dispatchAction_(action, body) {
  body = body || {};
  switch (action) {
    case 'getPublicState':
      return getPublicState_();
    case 'validateToken':
      return createFormSession_(body.token);
    case 'register':
      return registerCandidate_(body);
    case 'verifyAndRegister':
      return verifyAndRegister_(body);
    case 'getReceipt':
      return getReceipt_(body.receipt_token);
    case 'admin.login':
      return adminLogin_(body.pin, body.operator_name, body.source_id);
    case 'admin.logout':
      return adminLogout_(body.token);
    case 'admin.checkSession':
      return adminCheckSession_(body.token);
    case 'admin.getDashboard':
      return getAdminDashboard_();
    case 'admin.setQuickState':
      return setQuickState_(body.state);
    case 'admin.setRegistrationState':
      return setRegistrationState_(body.enabled);
    case 'admin.setQrVisible':
      return setQrVisible_(body.visible);
    case 'admin.updateSettings':
      return updateSettings_(body.settings);
    case 'admin.runInitialLottery':
      return runInitialLottery_(body.first_batch_count, body.advanced_rules);
    case 'admin.createPublishBatch':
      return createPublishBatch_(body.count);
    case 'admin.setDisplayedBatch':
      return setDisplayedBatch_(body.batch_id);
    case 'admin.createEvent':
      return createEvent_(body);
    case 'admin.archiveEvent':
      return archiveEvent_();
    case 'admin.export':
      return exportEventData_(body.type || 'full');
    case 'admin.clearEvent':
      return clearEventData_();
    default:
      return error_('UNKNOWN_ACTION', '未知的 action: ' + action);
  }
}

function runAction_(action, body) {
  body = body || {};
  var isAdminAction = action && action.indexOf('admin.') === 0;
  if (isAdminAction && action !== 'admin.login') {
    setAdminAuthToken_(body.token);
  }

  try {
    return dispatchAction_(action, body);
  } finally {
    if (isAdminAction) {
      clearAdminAuthContext_();
    }
  }
}

function routeAction_(action, body) {
  return handleApiRequest_(function () {
    return runAction_(action, body);
  });
}

/** 供 admin 頁 google.script.run 呼叫（回傳 plain object，非 ContentService） */
function apiCall(action, body) {
  try {
    return runAction_(action, body || {});
  } catch (e) {
    Logger.log(e.stack || e.message);
    if (e && e.code) {
      return error_(e.code, e.message || String(e));
    }
    return error_('INTERNAL_ERROR', e.message || String(e));
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}
