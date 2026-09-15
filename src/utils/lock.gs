function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
  if (!acquired) {
    throw new Error('系統忙碌中，請稍後再試');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
