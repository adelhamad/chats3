// Nonce replay protection store
const nonceStore = new Map(); // nonce -> timestamp
const NONCE_TTL = 120000; // 2 minutes

export function checkAndStoreNonce(nonce) {
  // Clean up old nonces
  const now = Date.now();
  for (const [storedNonce, timestamp] of nonceStore.entries()) {
    if (now - timestamp > NONCE_TTL) {
      nonceStore.delete(storedNonce);
    }
  }

  // Check if nonce was already used
  if (nonceStore.has(nonce)) {
    return false; // Replay attack
  }

  // Store nonce
  nonceStore.set(nonce, now);
  return true;
}

export function clearNonceStore() {
  nonceStore.clear();
}
