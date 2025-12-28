// Message service
import crypto from "crypto";

import sanitizeHtml from "sanitize-html";

import { appendMessages, getMessages } from "../storage/index.js";

export async function saveMessage(messageData) {
  const {
    messageId = crypto.randomUUID(),
    conversationId,
    senderUserId,
    senderDisplayName,
    senderAvatarUrl,
    senderRole,
    type = "text",
    body,
    clientTimestamp,
  } = messageData;

  const message = {
    messageId,
    conversationId,
    senderUserId,
    senderDisplayName,
    senderAvatarUrl,
    senderRole,
    type,
    body: sanitizeMessageBody(body),
    clientTimestamp,
    serverReceivedAt: new Date().toISOString(),
    // Pass through attachment fields if present
    attachmentId: messageData.attachmentId,
    filename: messageData.filename,
    mimetype: messageData.mimetype,
    url: messageData.url,
  };

  // Persist to S3
  await appendMessages(conversationId, [message]);

  return message;
}

export async function getConversationMessages(conversationId, limit = 100) {
  return await getMessages(conversationId, limit);
}

// Strip HTML from message body to prevent XSS
export function sanitizeMessageBody(body) {
  if (!body || typeof body !== "string") {
    return "";
  }

  return sanitizeHtml(body, {
    allowedTags: [], // No HTML tags allowed
    allowedAttributes: {}, // No attributes allowed
  });
}
