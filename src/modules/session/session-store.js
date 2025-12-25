// In-memory session store
import crypto from "crypto";

const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup interval (every hour)
setInterval(
  () => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      const lastActive =
        session.lastActiveAt || new Date(session.createdAt).getTime();
      if (now - lastActive > SESSION_TTL) {
        sessions.delete(sessionId);
      }
    }
  },
  60 * 60 * 1000,
).unref(); // unref to allow process to exit if needed

export function createSession(sessionData) {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = {
    sessionId,
    userId: sessionData.userId,
    displayName: sessionData.displayName,
    avatarUrl: sessionData.avatarUrl || null,
    role: sessionData.role || "user",
    conversationId: sessionData.conversationId,
    createdAt: now,
    lastActiveAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActiveAt = Date.now();
  }
  return session;
}

export function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

export function getSessionsByConversation(conversationId) {
  return Array.from(sessions.values()).filter(
    (session) => session.conversationId === conversationId,
  );
}

export function clearAllSessions() {
  sessions.clear();
}
