// In-memory signaling store for WebRTC
import crypto from "crypto";
import { EventEmitter } from "events";

export const signalingEmitter = new EventEmitter();
const signalingStore = new Map(); // conversationId -> events[]
const cursorStore = new Map(); // cursorToken -> { conversationId, index, createdAt }
const participantsStore = new Map(); // conversationId -> Set<userId>

const EVENT_TTL = 60000; // 60 seconds

// Cleanup interval (every minute)
setInterval(() => {
  const now = Date.now();

  // Cleanup events and empty conversations
  for (const [convId, events] of signalingStore.entries()) {
    const validEvents = events.filter((e) => now - e.timestamp < EVENT_TTL);
    if (validEvents.length === 0) {
      signalingStore.delete(convId);
    } else if (validEvents.length !== events.length) {
      signalingStore.set(convId, validEvents);
    }
  }

  // Cleanup cursors
  for (const [token, cursor] of cursorStore.entries()) {
    if (now - cursor.createdAt > EVENT_TTL) {
      cursorStore.delete(token);
    }
  }

  // Cleanup empty participant sets
  for (const [convId, participants] of participantsStore.entries()) {
    if (participants.size === 0) {
      participantsStore.delete(convId);
    }
  }
}, 60000).unref();

export function addParticipant(conversationId, userId) {
  if (!participantsStore.has(conversationId)) {
    participantsStore.set(conversationId, new Set());
  }
  participantsStore.get(conversationId).add(userId);
}

export function removeParticipant(conversationId, userId) {
  if (participantsStore.has(conversationId)) {
    participantsStore.get(conversationId).delete(userId);
  }
}

export function getParticipants(conversationId) {
  if (!participantsStore.has(conversationId)) {
    return [];
  }
  return Array.from(participantsStore.get(conversationId));
}

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

  // Emit event for SSE listeners
  signalingEmitter.emit(`event-${conversationId}`, signalingEvent);

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
    createdAt: Date.now(),
  });

  return {
    events: relevantEvents,
    cursor: newCursorToken,
  };
}

export function clearConversationSignaling(conversationId) {
  signalingStore.delete(conversationId);
}
