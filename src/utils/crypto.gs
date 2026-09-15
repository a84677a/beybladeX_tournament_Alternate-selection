function hmacToken_(eventId, timeWindow) {
  var payload = eventId + '|' + timeWindow;
  var signature = Utilities.computeHmacSha256Signature(payload, getScriptSecret_());
  return Utilities.base64EncodeWebSafe(signature);
}

function getCurrentTimeWindow_(intervalSeconds) {
  var now = Math.floor(Date.now() / 1000);
  return Math.floor(now / intervalSeconds);
}

function generateReceiptToken_() {
  return Utilities.getUuid();
}

function generateRequestId_() {
  return Utilities.getUuid();
}

function hashPin_(pin, salt) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    pin + '|' + salt,
    Utilities.Charset.UTF_8
  ).map(function (b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function fisherYatesShuffle_(array) {
  var arr = array.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = secureRandomInt_(i + 1);
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function secureRandomInt_(max) {
  if (max <= 0) return 0;
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + Date.now() + Math.random(),
    Utilities.Charset.UTF_8
  );
  var value = 0;
  for (var i = 0; i < 4; i++) {
    var b = bytes[i];
    if (b < 0) b += 256;
    value = (value << 8) + b;
  }
  return Math.abs(value) % max;
}
