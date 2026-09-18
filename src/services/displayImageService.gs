var DISPLAY_IMAGE_MIME_TYPES_ = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function getDisplayImageUrl_(fileId) {
  if (!fileId) {
    return '';
  }
  return getWebAppUrl() +
    '?page=display-image&v=' +
    encodeURIComponent(String(fileId));
}

var DRIVE_SCOPE_ = 'https://www.googleapis.com/auth/drive';

function formatDriveAuthMessage_() {
  return '投影圖片需要 Google Drive 權限。請按「授權 Google Drive」，在跳出的視窗完成授權後再試一次。' +
    '請使用部署此 Web App 的 Google 帳號操作。';
}

function getDriveAuthInfo_() {
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [DRIVE_SCOPE_]);
  var status = authInfo.getAuthorizationStatus();
  return {
    required: status !== ScriptApp.AuthorizationStatus.NOT_REQUIRED,
    url: authInfo.getAuthorizationUrl() || '',
    status: String(status)
  };
}

function buildDriveAuthError_() {
  var authInfo = getDriveAuthInfo_();
  return error_(
    'DRIVE_AUTH_REQUIRED',
    authInfo.url
      ? '需要 Google Drive 授權。請在跳出的視窗完成授權後，再試一次。'
      : formatDriveAuthMessage_(),
    { auth_url: authInfo.url }
  );
}

function ensureDriveAuthorizedOrError_() {
  var authInfo = getDriveAuthInfo_();
  if (authInfo.required) {
    return buildDriveAuthError_();
  }

  try {
    DriveApp.getRootFolder().getId();
    return null;
  } catch (err) {
    if (isDriveAuthError_(err)) {
      return buildDriveAuthError_();
    }
    throw err;
  }
}

function ensureDriveAuthorized_() {
  var authError = ensureDriveAuthorizedOrError_();
  if (authError) {
    throw new Error(authError.error.message);
  }
}

function resolveDisplayImagesFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('DISPLAY_IMAGES_FOLDER_ID');

  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (err) {
      props.deleteProperty('DISPLAY_IMAGES_FOLDER_ID');
    }
  }

  var folder = DriveApp.createFolder('候補系統_DisplayImages');
  props.setProperty('DISPLAY_IMAGES_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * 部署後請在 Apps Script 編輯器執行一次。
 * 此函式刻意不 catch Drive 錯誤，以便編輯器顯示「審查權限」。
 */
function authorizeDriveAccess() {
  var folder = resolveDisplayImagesFolder_();
  Logger.log('Google Drive 授權完成，資料夾 ID: ' + folder.getId());
  return 'Google Drive 授權完成';
}

function checkDriveAccess_() {
  requireAdmin_();
  var authError = ensureDriveAuthorizedOrError_();
  if (authError) {
    return authError;
  }

  try {
    resolveDisplayImagesFolder_();
    return success_({ authorized: true, message: 'Google Drive 授權正常' });
  } catch (err) {
    if (isDriveAuthError_(err)) {
      return buildDriveAuthError_();
    }
    return error_('DRIVE_CHECK_FAILED', err.message || 'Drive 檢查失敗');
  }
}

function getDriveAuthUrl_() {
  requireAdmin_();
  var authInfo = getDriveAuthInfo_();
  if (!authInfo.required) {
    try {
      resolveDisplayImagesFolder_();
      return success_({
        authorized: true,
        auth_url: '',
        message: 'Google Drive 授權正常'
      });
    } catch (err) {
      if (!isDriveAuthError_(err)) {
        return error_('DRIVE_CHECK_FAILED', err.message || 'Drive 檢查失敗');
      }
      authInfo = getDriveAuthInfo_();
    }
  }

  return success_({
    authorized: false,
    auth_url: authInfo.url || '',
    message: authInfo.url
      ? '請在跳出的視窗完成 Google Drive 授權'
      : formatDriveAuthMessage_()
  });
}

function getDisplayImagesFolder_() {
  ensureDriveAuthorized_();
  return resolveDisplayImagesFolder_();
}

function tryRemoveDriveFile_(fileId) {
  if (!fileId) {
    return;
  }

  try {
    ensureDriveAuthorized_();
    DriveApp.getFileById(String(fileId)).setTrashed(true);
  } catch (err) {
    Logger.log('remove display image failed: ' + (err.message || err));
  }
}

function uploadDisplayImage_(payload) {
  requireAdmin_();
  payload = payload || {};

  var authError = ensureDriveAuthorizedOrError_();
  if (authError) {
    return authError;
  }

  var mimeType = String(payload.mimeType || '').toLowerCase();
  var extension = DISPLAY_IMAGE_MIME_TYPES_[mimeType];
  if (!extension) {
    return error_('INVALID_IMAGE', '僅支援 JPG、PNG、WebP 圖片');
  }

  var data = String(payload.data || '');
  if (!data) {
    return error_('INVALID_IMAGE', '缺少圖片資料');
  }

  var bytes = Utilities.base64Decode(data);
  if (!bytes || !bytes.length) {
    return error_('INVALID_IMAGE', '無法解析圖片資料');
  }

  var maxBytes = CONFIG.DEFAULTS.DISPLAY_IMAGE_MAX_BYTES || 2097152;
  if (bytes.length > maxBytes) {
    return error_('FILE_TOO_LARGE', '圖片大小不可超過 2MB');
  }

  try {
    var settings = getAllSettings_();
    var oldFileId = settings.display_image_file_id || '';
    var folder = getDisplayImagesFolder_();
    var blob = Utilities.newBlob(
      bytes,
      mimeType,
      'display-image.' + extension
    );
    var file = folder.createFile(blob);

    setSettings_({
      display_image_file_id: file.getId(),
      show_display_image: true
    });
    if (oldFileId && oldFileId !== file.getId()) {
      tryRemoveDriveFile_(oldFileId);
    }

    appendAuditLog_('UPLOAD_DISPLAY_IMAGE', { file_id: file.getId() });
    return attachAdminSettingsMutation_({}, getAllSettings_());
  } catch (err) {
    Logger.log('upload display image failed: ' + (err.stack || err.message || err));
    if (isDriveAuthError_(err)) {
      return buildDriveAuthError_();
    }
    return error_('UPLOAD_FAILED', err.message || '圖片上傳失敗');
  }
}

function removeDisplayImage_() {
  requireAdmin_();

  var authError = ensureDriveAuthorizedOrError_();
  if (authError) {
    return authError;
  }

  var settings = getAllSettings_();
  var fileId = settings.display_image_file_id || '';
  if (fileId) {
    tryRemoveDriveFile_(fileId);
  }

  setSettings_({
    display_image_file_id: '',
    show_display_image: false
  });

  appendAuditLog_('REMOVE_DISPLAY_IMAGE', { file_id: fileId || null });
  return attachAdminSettingsMutation_({}, getAllSettings_());
}

function readDisplayImageBlob_(fileId) {
  if (!fileId) {
    return null;
  }

  var file = DriveApp.getFileById(String(fileId));
  return file.getBlob();
}

function getPublicDisplayImage_() {
  var settings = getAllSettings_();
  if (!settings.show_display_image || !settings.display_image_file_id) {
    return success_({ has_image: false });
  }

  try {
    var fileId = String(settings.display_image_file_id);
    var blob = readDisplayImageBlob_(fileId);
    var mimeType = blob.getContentType() || 'image/png';
    return success_({
      has_image: true,
      file_id: fileId,
      mime_type: mimeType,
      data_url: 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes())
    });
  } catch (err) {
    Logger.log('public display image failed: ' + (err.message || err));
    return success_({ has_image: false });
  }
}

function getDisplayImagePreview_() {
  requireAdmin_();

  var settings = getAllSettings_();
  var fileId = settings.display_image_file_id;
  if (!fileId) {
    return success_({ has_image: false });
  }

  try {
    var blob = readDisplayImageBlob_(fileId);
    var mimeType = blob.getContentType() || 'image/png';
    return success_({
      has_image: true,
      mime_type: mimeType,
      data_url: 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes())
    });
  } catch (err) {
    Logger.log('display image preview failed: ' + (err.message || err));
    if (isDriveAuthError_(err)) {
      return buildDriveAuthError_();
    }
    return error_('PREVIEW_FAILED', '無法讀取投影圖片預覽');
  }
}

function serveDisplayImage_() {
  var settings = getAllSettings_();
  var fileId = settings.display_image_file_id;
  if (!fileId) {
    return ContentService.createTextOutput('Not found')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    var blob = readDisplayImageBlob_(fileId);
    return ContentService.createBlobOutput(blob)
      .setMimeType(blob.getContentType() || 'image/png');
  } catch (err) {
    Logger.log('serve display image failed: ' + (err.message || err));
    return ContentService.createTextOutput('Not found')
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function isDriveAuthError_(err) {
  var message = String((err && err.message) || err || '');
  return message.indexOf('DriveApp') !== -1 ||
    message.indexOf('authorization') !== -1 ||
    message.indexOf('權限') !== -1 ||
    message.indexOf('permission') !== -1;
}
