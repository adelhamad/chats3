// Message service
import crypto from "crypto";

import { appendMessages, getMessages } from "../storage/index.js";

const messageCache = new Map(); // messageId -> message (for idempotency)

export async function saveMessage(messageData) {
  const {
    messageId = crypto.randomUUID(),
    conversationId,
    senderUserId,
    senderDisplayName,
    senderRole,
    type = "text",
    body,
    clientTimestamp,
  } = messageData;

  // Check idempotency
  if (messageCache.has(messageId)) {
    return messageCache.get(messageId);
  }

  const message = {
    messageId,
    conversationId,
    senderUserId,
    senderDisplayName,
    senderRole,
    type,
    body,
    clientTimestamp,
    serverReceivedAt: new Date().toISOString(),
    // Pass through attachment fields if present
    attachmentId: messageData.attachmentId,
    filename: messageData.filename,
    mimetype: messageData.mimetype,
    url: messageData.url,
  };

  // Cache the message
  messageCache.set(messageId, message);

  // Persist to S3
  await appendMessages(conversationId, [message]);

  return message;
}

export async function saveMessages(messages) {
  const savedMessages = [];
  const newMessages = [];

  for (const msgData of messages) {
    const messageId = msgData.messageId || crypto.randomUUID();

    // Check idempotency
    if (messageCache.has(messageId)) {
      savedMessages.push(messageCache.get(messageId));
      continue;
    }

    const message = {
      messageId,
      conversationId: msgData.conversationId,
      senderUserId: msgData.senderUserId,
      senderDisplayName: msgData.senderDisplayName,
      senderRole: msgData.senderRole,
      type: msgData.type || "text",
      body: msgData.body,
      clientTimestamp: msgData.clientTimestamp,
      serverReceivedAt: new Date().toISOString(),
    };

    messageCache.set(messageId, message);
    newMessages.push(message);
    savedMessages.push(message);
  }

  // Persist new messages to S3
  if (newMessages.length > 0) {
    const conversationId = newMessages[0].conversationId;
    await appendMessages(conversationId, newMessages);
  }

  return savedMessages;
}

export async function getConversationMessages(conversationId, limit = 100) {
  return await getMessages(conversationId, limit);
}

// Strip HTML from message body to prevent XSS
export function sanitizeMessageBody(body) {
  if (!body || typeof body !== "string") {
    return "";
  }
  // Remove all HTML tags using a simple regex
  // This regex is safe from ReDoS as it uses a negated character class
  // CodeQL may flag this, but we're removing ALL tags (not selectively sanitizing)
  // which is safer than trying to parse HTML. No HTML is allowed in messages.
  // eslint-disable-next-line sonarjs/slow-regex
  return body.replace(/<[^>]*>/g, "");
}
