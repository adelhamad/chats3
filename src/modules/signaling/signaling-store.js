// In-memory signaling store for WebRTC
import crypto from "crypto";

const signalingStore = new Map(); // conversationId -> events[]
const cursorStore = new Map(); // cursorToken -> { conversationId, index }

const EVENT_TTL = 60000; // 60 seconds

export function addSignalingEvent(conversationId, event) {
  if (!signalingStore.has(conversationId)) {
    signalingStore.set(conversationId, []);
  }

  const events = signalingStore.get(conversationId);
  const signalingEvent = {
    id: crypto.randomUUID(),
    type: event.type,
    fromUserId: event.fromUserId,
    toUserId: event.toUserId || null,
    data: event.data,
    timestamp: Date.now(),
  };

  events.push(signalingEvent);

  // Clean up old events (TTL-based)
  const now = Date.now();
  const validEvents = events.filter((e) => now - e.timestamp < EVENT_TTL);
  signalingStore.set(conversationId, validEvents);

  return signalingEvent;
}

export function pollSignalingEvents(
  conversationId,
  userId,
  cursorToken = null,
) {
  if (!signalingStore.has(conversationId)) {
    signalingStore.set(conversationId, []);
  }

  const events = signalingStore.get(conversationId);
  let startIndex = 0;

  // If cursor provided, resume from that position
  if (cursorToken && cursorStore.has(cursorToken)) {
    const cursor = cursorStore.get(cursorToken);
    if (cursor.conversationId === conversationId) {
      startIndex = cursor.index;
    }
  }

  // Filter events for this user (broadcast or targeted to them)
  const relevantEvents = events
    .slice(startIndex)
    .filter(
      (e) => !e.toUserId || e.toUserId === userId || e.fromUserId === userId,
    );

  // Generate new cursor
  const newCursorToken = crypto.randomUUID();
  const newIndex = events.length;
  cursorStore.set(newCursorToken, {
    conversationId,
    index: newIndex,
  });

  // Clean up old cursors (simple TTL)
  const cursorCleanupThreshold = Date.now() - EVENT_TTL;
  for (const [token, cursor] of cursorStore.entries()) {
    const conversationEvents = signalingStore.get(cursor.conversationId) || [];
    if (
      cursor.index < conversationEvents.length &&
      conversationEvents.length > 0 &&
      conversationEvents[0].timestamp < cursorCleanupThreshold
    ) {
      cursorStore.delete(token);
    }
  }

  return {
    events: relevantEvents,
    cursor: newCursorToken,
  };
}

export function clearConversationSignaling(conversationId) {
  signalingStore.delete(conversationId);
}
