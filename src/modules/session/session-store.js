// In-memory session store
import crypto from "crypto";

const sessions = new Map();

export function createSession(sessionData) {
  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    userId: sessionData.userId,
    displayName: sessionData.displayName,
    avatarUrl: sessionData.avatarUrl || null,
    role: sessionData.role || "user",
    conversationId: sessionData.conversationId,
    createdAt: new Date().toISOString(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
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
