function jsonResponse_(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function success_(data) {
  return { ok: true, data: data || {}, error: null };
}

function error_(code, message, extra) {
  var err = { code: code, message: message };
  if (extra) {
    Object.keys(extra).forEach(function (key) {
      err[key] = extra[key];
    });
  }
  return { ok: false, data: null, error: err };
}

function handleApiRequest_(handler) {
  try {
    var result = handler();
    return jsonResponse_(result);
  } catch (e) {
    Logger.log(e.stack || e.message);
    if (e && e.code) {
      return jsonResponse_(error_(e.code, e.message || String(e)));
    }
    return jsonResponse_(error_('INTERNAL_ERROR', e.message || String(e)));
  }
}
