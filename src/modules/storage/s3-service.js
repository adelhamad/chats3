// S3 Storage Service
import crypto from "crypto";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let s3Client = null;
let bucketName = null;

export function initializeS3(config) {
  const s3Config = {
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
  };

  // Only add credentials if they are provided
  if (config.S3_ACCESS_KEY && config.S3_SECRET_KEY) {
    s3Config.credentials = {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    };
  }

  s3Client = new S3Client(s3Config);
  bucketName = config.S3_BUCKET;
}

export function getS3Client() {
  if (!s3Client) {
    throw new Error("S3 client not initialized");
  }
  return s3Client;
}

export function getBucketName() {
  if (!bucketName) {
    throw new Error("S3 bucket name not configured");
  }
  return bucketName;
}

// Store conversation metadata
export async function putConversationMeta(conversationId, metadata) {
  const key = `conversations/${conversationId}/meta.json`;
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: "application/json",
  });
  await s3Client.send(command);
}

// Get conversation metadata
export async function getConversationMeta(conversationId) {
  const key = `conversations/${conversationId}/meta.json`;
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const response = await s3Client.send(command);
    const body = await response.Body.transformToString();
    return JSON.parse(body);
  } catch (error) {
    if (error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

// Append messages to NDJSON file
// FIXED: Writes a unique file per batch to avoid S3 overwrite race conditions
export async function appendMessages(conversationId, messages) {
  const date = new Date().toISOString().split("T")[0];
  const timestamp = Date.now();
  const uuid = crypto.randomUUID();
  // Use a unique key for every batch to ensure atomicity
  const key = `conversations/${conversationId}/messages/${date}/${timestamp}-${uuid}.ndjson`;

  const content = messages.map((msg) => JSON.stringify(msg)).join("\n");

  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: content,
    ContentType: "application/x-ndjson",
  });
  await s3Client.send(putCommand);
}

// Get messages for a conversation
export async function getMessages(conversationId, limit = 100) {
  const prefix = `conversations/${conversationId}/messages/`;
  const listCommand = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const listResponse = await s3Client.send(listCommand);
  if (!listResponse.Contents || listResponse.Contents.length === 0) {
    return [];
  }

  // Get all message files (sorted by key which includes date)
  const messageFiles = listResponse.Contents.filter((obj) =>
    obj.Key.endsWith(".ndjson"),
  ).sort((a, b) => b.Key.localeCompare(a.Key)); // Most recent first

  const allMessages = [];
  for (const file of messageFiles) {
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: file.Key,
    });
    const response = await s3Client.send(getCommand);
    const content = await response.Body.transformToString();
    const messages = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    allMessages.push(...messages);

    if (allMessages.length >= limit) {
      break;
    }
  }

  // Return most recent messages first, limited
  // But wait, the frontend expects chronological order (oldest first) to append to the bottom.
  // `allMessages` currently has chunks of messages.
  // If we read files in reverse order (newest file first), `allMessages` will be [newest_chunk, older_chunk, ...].
  // And within each chunk, messages are appended (oldest to newest).
  // So we have [msg100..msg110, msg90..msg99, ...]. This is mixed order.

  // Let's sort everything by timestamp to be safe.
  allMessages.sort((a, b) => {
    const tA = new Date(a.serverReceivedAt || a.clientTimestamp).getTime();
    const tB = new Date(b.serverReceivedAt || b.clientTimestamp).getTime();
    return tA - tB;
  });

  // Now we have oldest -> newest.
  // If we want to limit to 100, we should take the *last* 100 (most recent).
  return allMessages.slice(-limit);
}

// Store attachment
export async function putAttachment(
  conversationId,
  attachmentId,
  buffer,
  metadata,
) {
  const key = `conversations/${conversationId}/attachments/${attachmentId}/original`;

  // Sanitize filename for metadata header (ASCII only)
  // Or just use encodeURIComponent if we want to preserve it fully, but S3 metadata has strict rules.
  // Safest is to strip non-ASCII or just rely on the separate meta.json file for the real name.
  // Let's just use a safe version for the header.
  const safeFilename = metadata.originalFilename.replace(/[^\x20-\x7E]/g, "");

  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: metadata.mimeType,
    Metadata: {
      originalFilename: safeFilename,
      uploaderUserId: metadata.uploaderUserId,
    },
  });
  await s3Client.send(putCommand);

  // Store metadata
  const metaKey = `conversations/${conversationId}/attachments/${attachmentId}/meta.json`;
  const metaCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: metaKey,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: "application/json",
  });
  await s3Client.send(metaCommand);
}

// Get attachment metadata
export async function getAttachmentMeta(conversationId, attachmentId) {
  const key = `conversations/${conversationId}/attachments/${attachmentId}/meta.json`;
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const response = await s3Client.send(command);
    const body = await response.Body.transformToString();
    return JSON.parse(body);
  } catch (error) {
    if (error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

// Get signed URL for attachment download
export async function getAttachmentSignedUrl(
  conversationId,
  attachmentId,
  expiresIn = 900,
) {
  const key = `conversations/${conversationId}/attachments/${attachmentId}/original`;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn });
}

// Check if attachment exists
export async function attachmentExists(conversationId, attachmentId) {
  const key = `conversations/${conversationId}/attachments/${attachmentId}/original`;
  try {
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === "NotFound" || error.name === "NoSuchKey") {
      return false;
    }
    throw error;
  }
}
