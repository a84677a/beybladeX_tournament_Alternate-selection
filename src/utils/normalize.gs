function normalizeName_(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, '');
}

function normalizePhone_(phone) {
  if (!phone) return '';
  var digits = String(phone).replace(/[\s\-()]/g, '');
  if (digits.indexOf('+886') === 0) {
    digits = '0' + digits.substring(4);
  } else if (digits.indexOf('886') === 0 && digits.length >= 11) {
    digits = '0' + digits.substring(3);
  }
  return digits;
}

function maskPhone_(phone) {
  var normalized = normalizePhone_(phone);
  if (normalized.length < 7) return normalized;
  return normalized.substring(0, 4) + '***' + normalized.substring(normalized.length - 3);
}

function isValidPhone_(phone) {
  var normalized = normalizePhone_(phone);
  return /^09\d{8}$/.test(normalized);
}

function isValidName_(name) {
  var normalized = normalizeName_(name);
  return normalized.length >= 2 && normalized.length <= 20;
}

function formatWaitlistNo_(num) {
  var n = Number(num);
  if (isNaN(n) || n < 1) return '#001';
  return '#' + String(n).padStart(3, '0');
}
