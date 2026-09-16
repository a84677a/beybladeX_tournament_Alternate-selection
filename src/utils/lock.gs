function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
  if (!acquired) {
    var busy = new Error('系統忙碌中，請稍後再試');
    busy.code = 'BUSY';
    throw busy;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
