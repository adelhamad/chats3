// In-memory conversation store
import crypto from "crypto";

import { putConversationMeta, getConversationMeta } from "../storage/index.js";

const conversations = new Map();
const CONVERSATION_TTL = 24 * 60 * 60 * 1000; // 24 hours (remove from memory, not S3)

// Cleanup interval (every hour)
setInterval(
  () => {
    const now = Date.now();
    for (const [id, conv] of conversations.entries()) {
      const lastAccessed =
        conv.lastAccessedAt || new Date(conv.createdAt).getTime();
      if (now - lastAccessed > CONVERSATION_TTL) {
        conversations.delete(id);
      }
    }
  },
  60 * 60 * 1000,
).unref();

// Generate a short, human-readable join code
function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous characters
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function createConversation(conversationId) {
  if (conversations.has(conversationId)) {
    throw new Error("Conversation already exists");
  }

  const joinCode = generateJoinCode();
  const conversation = {
    conversationId,
    joinCode,
    status: "active",
    createdAt: new Date().toISOString(),
    closedAt: null,
    lastAccessedAt: Date.now(),
  };

  conversations.set(conversationId, conversation);

  // Persist to S3
  await putConversationMeta(conversationId, conversation);

  return conversation;
}

export async function getConversation(conversationId) {
  // Check in-memory first
  if (conversations.has(conversationId)) {
    const conv = conversations.get(conversationId);
    conv.lastAccessedAt = Date.now();
    return conv;
  }

  // Try to load from S3
  const meta = await getConversationMeta(conversationId);
  if (meta) {
    meta.lastAccessedAt = Date.now();
    conversations.set(conversationId, meta);
    return meta;
  }

  return null;
}

export async function closeConversation(conversationId) {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  conversation.status = "closed";
  conversation.closedAt = new Date().toISOString();

  conversations.set(conversationId, conversation);

  // Persist to S3
  await putConversationMeta(conversationId, conversation);

  return conversation;
}

export async function validateJoinCode(conversationId, joinCode) {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return false;
  }
  return conversation.joinCode === joinCode && conversation.status === "active";
}

export function generateConversationId() {
  return `conv-${crypto.randomUUID()}`;
}
