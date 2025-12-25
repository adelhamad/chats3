// Nonce replay protection store
const nonceStore = new Map(); // nonce -> timestamp
const NONCE_TTL = 120000; // 2 minutes

// Cleanup interval (every 30 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [storedNonce, timestamp] of nonceStore.entries()) {
    if (now - timestamp > NONCE_TTL) {
      nonceStore.delete(storedNonce);
    }
  }
}, 30000).unref();

export function checkAndStoreNonce(nonce) {
  // Check if nonce was already used
  if (nonceStore.has(nonce)) {
    return false; // Replay attack
  }

  // Store nonce
  nonceStore.set(nonce, Date.now());
  return true;
}

export function clearNonceStore() {
  nonceStore.clear();
}
