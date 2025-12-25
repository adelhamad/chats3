// Attachment service
import crypto from "crypto";

import { fileTypeFromBuffer } from "file-type";

import {
  putAttachment,
  getAttachmentMeta,
  getAttachmentSignedUrl,
  attachmentExists,
} from "../storage/index.js";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadAttachment(conversationId, uploaderUserId, file) {
  const { filename, mimetype, file: buffer } = file;

  // Validate mime type (trust but verify)
  if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
    throw new Error("File type not allowed");
  }

  // Verify magic numbers
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ALLOWED_MIME_TYPES.includes(type.mime)) {
    // Special case for text/plain which might not be detected by file-type
    if (mimetype === "text/plain" && !type) {
      // It's likely a text file, we can allow it if the extension matches
      // or just trust it for text files as they are less risky (if served with correct headers)
    } else {
      throw new Error("Invalid file content (magic number mismatch)");
    }
  }

  // Validate size
  const sizeBytes = buffer.length;
  if (sizeBytes > MAX_FILE_SIZE) {
    throw new Error("File too large");
  }

  const attachmentId = crypto.randomUUID();
  const metadata = {
    attachmentId,
    conversationId,
    uploaderUserId,
    originalFilename: filename,
    mimeType: mimetype,
    sizeBytes,
    createdAt: new Date().toISOString(),
    variants: null,
  };

  await putAttachment(conversationId, attachmentId, buffer, metadata);

  return {
    attachmentId,
    originalFilename: filename,
    mimeType: mimetype,
    sizeBytes,
  };
}

export async function getAttachment(conversationId, attachmentId) {
  const exists = await attachmentExists(conversationId, attachmentId);
  if (!exists) {
    return null;
  }

  const metadata = await getAttachmentMeta(conversationId, attachmentId);
  const signedUrl = await getAttachmentSignedUrl(
    conversationId,
    attachmentId,
    900,
  );

  return {
    metadata,
    signedUrl,
  };
}
