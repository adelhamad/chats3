// In-memory conversation store
import crypto from "crypto";

import { putConversationMeta, getConversationMeta } from "../storage/index.js";

const conversations = new Map();

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
  };

  conversations.set(conversationId, conversation);

  // Persist to S3
  await putConversationMeta(conversationId, conversation);

  return conversation;
}

export async function getConversation(conversationId) {
  // Check in-memory first
  if (conversations.has(conversationId)) {
    return conversations.get(conversationId);
  }

  // Try to load from S3
  const meta = await getConversationMeta(conversationId);
  if (meta) {
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
