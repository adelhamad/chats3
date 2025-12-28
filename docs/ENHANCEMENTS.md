# Chats3 Service - Enhancement Recommendations

This document outlines recommended enhancements for the Chats3 service, organized by priority and category.

---

## High Priority Enhancements

### 1. Input Validation Hardening

**Problem:** Some Zod schemas lack maximum length constraints, potentially allowing abuse.

**Current State:**
```javascript
const messageSchema = z.object({
  body: z.string(), // No max length!
  // ...
});
```

**Recommended Changes:**

```javascript
// Message schema with limits
const messageSchema = z.object({
  messageId: z.string().uuid().optional(),
  type: z.enum(["text", "system", "file"]).default("text"),
  body: z.string().max(10000), // 10KB max
  clientTimestamp: z.string().datetime(),
  attachmentId: z.string().uuid().optional(),
  filename: z.string().max(255).optional(),
  mimetype: z.string().max(100).optional(),
  url: z.string().url().max(2048).optional(),
});

// Join schema hardening
const joinSchema = z.object({
  conversationId: z.string().max(100).regex(/^[a-zA-Z0-9-_]+$/),
  joinCode: z.string().length(6).regex(/^[A-Z0-9]+$/),
  displayName: z.string().min(1).max(50).trim(),
  avatarUrl: z.string().url().max(500).optional(),
});

// Batch messages limit
const batchMessagesSchema = z.object({
  messages: z.array(messageSchema).max(50), // Max 50 messages per batch
});
```

**Files to Update:**
- `src/modules/chat/routes.js`

---

### 2. Conversation Participant Limits

**Problem:** No limit on participants per conversation can lead to resource exhaustion.

**Implementation:**

```javascript
// src/constants/limits.js
export const LIMITS = {
  MAX_PARTICIPANTS_PER_CONVERSATION: 50,
  MAX_MESSAGES_PER_BATCH: 50,
  MAX_MESSAGE_LENGTH: 10000,
  MAX_DISPLAY_NAME_LENGTH: 50,
  MAX_ATTACHMENT_SIZE: 10 * 1024 * 1024,
};
```

```javascript
// In join handler
import { LIMITS } from "../../constants/limits.js";

const existingSessions = getSessionsByConversation(conversationId);
if (existingSessions.length >= LIMITS.MAX_PARTICIPANTS_PER_CONVERSATION) {
  reply.status(403);
  return fail.parse({ 
    message: "Conversation is full",
    details: { maxParticipants: LIMITS.MAX_PARTICIPANTS_PER_CONVERSATION }
  });
}
```

---

### 3. Graceful Shutdown Handler

**Problem:** No graceful shutdown causes SSE connections to drop without cleanup.

**Implementation:**

```javascript
// src/app.js
export async function start() {
  try {
    const app = await buildApp();
    
    // Graceful shutdown handler
    const shutdown = async (signal) => {
      app.log.info({ signal }, "Received shutdown signal");
      
      // Stop accepting new connections
      await app.close();
      
      // Cleanup resources
      // Note: In-memory stores will be lost anyway
      // But we can flush any pending operations
      
      app.log.info("Shutdown complete");
      process.exit(0);
    };
    
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    
    await app.listen({
      port: app.config.PORT,
      host: app.config.HOST,
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
```

---

### 4. API Documentation (OpenAPI/Swagger)

**Problem:** No API documentation for integrators.

**Implementation:**

```bash
yarn add @fastify/swagger @fastify/swagger-ui
```

```javascript
// src/app.js
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";

await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Chats3 API",
      description: "Real-time chat microservice API",
      version: "1.0.0",
    },
    servers: [
      { url: "http://localhost:3000", description: "Development" },
    ],
    tags: [
      { name: "chat", description: "Chat operations" },
      { name: "admin", description: "Admin operations" },
      { name: "signaling", description: "WebRTC signaling" },
    ],
  },
});

await app.register(fastifySwaggerUi, {
  routePrefix: "/docs",
});
```

Then add schema definitions to routes:
```javascript
fastify.post("/messages", {
  preHandler: requireSession,
  schema: {
    description: "Send a message to the conversation",
    tags: ["chat"],
    body: {
      type: "object",
      required: ["body", "clientTimestamp"],
      properties: {
        body: { type: "string", maxLength: 10000 },
        type: { type: "string", enum: ["text", "system", "file"] },
        clientTimestamp: { type: "string", format: "date-time" },
      },
    },
    response: {
      200: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          message: { type: "string" },
          details: { type: "object" },
        },
      },
    },
  },
}, handler);
```

---

## Medium Priority Enhancements

### 5. Typing Indicators

**Implementation:**

Add new signaling event types:

```javascript
// src/modules/chat/routes.js
const signalingSchema = z.object({
  type: z.enum([
    "peer-join",
    "peer-leave",
    "offer",
    "answer",
    "ice-candidate",
    "new-message",
    "end-call",
    "typing-start",  // New
    "typing-stop",   // New
  ]),
  toUserId: z.string().nullish(),
  data: z.any(),
});
```

Client-side implementation:
```javascript
// src/modules/ui/public/js/room.js
let typingTimeout;

messageInput.addEventListener("input", () => {
  // Debounced typing indicator
  if (!typingTimeout) {
    sendSignalingEvent("typing-start", undefined, {
      userId: sessionInfo.userId,
      displayName: sessionInfo.displayName,
    });
  }
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    sendSignalingEvent("typing-stop", undefined, {
      userId: sessionInfo.userId,
    });
    typingTimeout = null;
  }, 2000);
});
```

---

### 6. Read Receipts

**Implementation:**

Add read receipt endpoint:

```javascript
// New endpoint
fastify.post("/messages/:messageId/read", {
  preHandler: requireSession,
}, async (request, reply) => {
  const { messageId } = request.params;
  
  addSignalingEvent(request.session.conversationId, {
    type: "message-read",
    fromUserId: request.session.userId,
    data: { messageId },
  });
  
  return success.parse({ message: "Read receipt sent" });
});
```

Add new signaling type:
```javascript
type: z.enum([
  // ... existing
  "message-read",
]),
```

---

### 7. Message Pagination

**Problem:** Current implementation returns only last 100 messages with no pagination.

**Implementation:**

```javascript
// src/modules/chat/routes.js
const messagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  direction: z.enum(["older", "newer"]).default("older"),
});

fastify.get("/messages", {
  preHandler: requireSession,
}, async (request, reply) => {
  const { cursor, limit, direction } = messagesQuerySchema.parse(request.query);
  
  const result = await getConversationMessages(
    request.session.conversationId,
    { cursor, limit, direction }
  );
  
  return success.parse({
    message: "Messages retrieved",
    details: {
      messages: result.messages,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});
```

Update message service:
```javascript
// src/modules/message/message-service.js
export async function getConversationMessages(conversationId, options = {}) {
  const { cursor, limit = 50, direction = "older" } = options;
  
  const messages = await getMessages(conversationId, limit + 1, cursor, direction);
  const hasMore = messages.length > limit;
  
  if (hasMore) {
    messages.pop();
  }
  
  const nextCursor = hasMore 
    ? messages[messages.length - 1].serverReceivedAt 
    : null;
  
  return { messages, nextCursor, hasMore };
}
```

---

### 8. Presence Status

**Implementation:**

Add presence store:

```javascript
// src/modules/presence/presence-store.js
const presenceStore = new Map(); // conversationId -> Map<userId, status>

export function updatePresence(conversationId, userId, status) {
  if (!presenceStore.has(conversationId)) {
    presenceStore.set(conversationId, new Map());
  }
  presenceStore.get(conversationId).set(userId, {
    status, // "online", "away", "offline"
    lastSeen: Date.now(),
  });
}

export function getPresence(conversationId) {
  return presenceStore.get(conversationId) || new Map();
}
```

Add presence endpoint:
```javascript
fastify.get("/presence", {
  preHandler: requireSession,
}, async (request) => {
  const presence = getPresence(request.session.conversationId);
  return success.parse({
    message: "Presence retrieved",
    details: Object.fromEntries(presence),
  });
});

fastify.post("/presence", {
  preHandler: requireSession,
}, async (request) => {
  const { status } = request.body;
  updatePresence(
    request.session.conversationId,
    request.session.userId,
    status
  );
  
  addSignalingEvent(request.session.conversationId, {
    type: "presence-update",
    fromUserId: request.session.userId,
    data: { status },
  });
  
  return success.parse({ message: "Presence updated" });
});
```

---

### 9. S3 Retry Logic

**Problem:** S3 operations can fail transiently.

**Implementation:**

```javascript
// src/utils/retry.js
export async function withRetry(fn, options = {}) {
  const { maxRetries = 3, baseDelay = 100, maxDelay = 5000 } = options;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt) + Math.random() * 100,
        maxDelay
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

Usage in S3 service:
```javascript
import { withRetry } from "../../utils/retry.js";

export async function appendMessages(conversationId, messages) {
  return withRetry(async () => {
    // ... existing implementation
    await s3Client.send(putCommand);
  });
}
```

---

## Low Priority Enhancements

### 10. WebSocket Support

**Rationale:** SSE is unidirectional; WebSocket provides lower latency bidirectional communication.

**Implementation Approach:**
```bash
yarn add @fastify/websocket
```

```javascript
import fastifyWebsocket from "@fastify/websocket";

await app.register(fastifyWebsocket);

fastify.get("/ws/signaling", {
  websocket: true,
  preHandler: requireSession,
}, (socket, request) => {
  const { conversationId, userId } = request.session;
  
  // Handle incoming messages
  socket.on("message", (data) => {
    const event = JSON.parse(data);
    addSignalingEvent(conversationId, {
      ...event,
      fromUserId: userId,
    });
  });
  
  // Subscribe to conversation events
  const onEvent = (event) => {
    if (!event.toUserId || event.toUserId === userId) {
      socket.send(JSON.stringify(event));
    }
  };
  
  signalingEmitter.on(`event-${conversationId}`, onEvent);
  
  socket.on("close", () => {
    signalingEmitter.off(`event-${conversationId}`, onEvent);
  });
});
```

---

### 11. Message Editing & Deletion

**Implementation:**

```javascript
// Edit message
fastify.patch("/messages/:messageId", {
  preHandler: requireSession,
}, async (request, reply) => {
  const { messageId } = request.params;
  const { body } = request.body;
  
  const message = await getMessage(messageId);
  
  // Verify ownership
  if (message.senderUserId !== request.session.userId) {
    reply.status(403);
    return fail.parse({ message: "Cannot edit others' messages" });
  }
  
  // Time limit (5 minutes)
  const messageAge = Date.now() - new Date(message.serverReceivedAt).getTime();
  if (messageAge > 5 * 60 * 1000) {
    reply.status(403);
    return fail.parse({ message: "Edit time limit exceeded" });
  }
  
  const updated = await updateMessage(messageId, {
    body: sanitizeMessageBody(body),
    editedAt: new Date().toISOString(),
  });
  
  addSignalingEvent(request.session.conversationId, {
    type: "message-edited",
    fromUserId: request.session.userId,
    data: updated,
  });
  
  return success.parse({ message: "Message edited", details: updated });
});

// Delete message
fastify.delete("/messages/:messageId", {
  preHandler: requireSession,
}, async (request, reply) => {
  // Similar ownership and time checks
  // Mark as deleted rather than removing
  await updateMessage(messageId, {
    deleted: true,
    deletedAt: new Date().toISOString(),
  });
  
  addSignalingEvent(request.session.conversationId, {
    type: "message-deleted",
    fromUserId: request.session.userId,
    data: { messageId },
  });
  
  return success.parse({ message: "Message deleted" });
});
```

---

### 12. Message Reactions

**Implementation:**

```javascript
const reactionSchema = z.object({
  emoji: z.string().max(10), // Single emoji or shortcode
});

fastify.post("/messages/:messageId/reactions", {
  preHandler: requireSession,
}, async (request, reply) => {
  const { messageId } = request.params;
  const { emoji } = reactionSchema.parse(request.body);
  
  await addReaction(messageId, request.session.userId, emoji);
  
  addSignalingEvent(request.session.conversationId, {
    type: "reaction-added",
    fromUserId: request.session.userId,
    data: { messageId, emoji },
  });
  
  return success.parse({ message: "Reaction added" });
});

fastify.delete("/messages/:messageId/reactions/:emoji", {
  preHandler: requireSession,
}, async (request, reply) => {
  const { messageId, emoji } = request.params;
  
  await removeReaction(messageId, request.session.userId, emoji);
  
  addSignalingEvent(request.session.conversationId, {
    type: "reaction-removed",
    fromUserId: request.session.userId,
    data: { messageId, emoji },
  });
  
  return success.parse({ message: "Reaction removed" });
});
```

---

### 13. Image Thumbnails

**Implementation:**

```bash
yarn add sharp
```

```javascript
// src/modules/attachment/attachment-service.js
import sharp from "sharp";

const THUMBNAIL_SIZE = 200;

async function generateThumbnail(buffer, mimetype) {
  if (!mimetype.startsWith("image/")) {
    return null;
  }
  
  try {
    return await sharp(buffer)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function uploadAttachment(conversationId, uploaderUserId, file) {
  // ... existing validation
  
  const attachmentId = crypto.randomUUID();
  
  // Generate thumbnail for images
  const thumbnail = await generateThumbnail(buffer, mimetype);
  
  // Upload original
  await putAttachment(conversationId, attachmentId, buffer, metadata);
  
  // Upload thumbnail if generated
  if (thumbnail) {
    await putAttachmentThumbnail(conversationId, attachmentId, thumbnail);
  }
  
  return {
    attachmentId,
    originalFilename: filename,
    mimeType: mimetype,
    sizeBytes,
    hasThumbnail: !!thumbnail,
  };
}
```

---

## Enhancement Priority Matrix

| Enhancement | Effort | Impact | Priority |
|-------------|--------|--------|----------|
| Input validation hardening | Low | High | **P1** |
| Participant limits | Low | High | **P1** |
| Graceful shutdown | Low | Medium | **P1** |
| API documentation | Medium | High | **P1** |
| Typing indicators | Low | Medium | **P2** |
| Read receipts | Medium | Medium | **P2** |
| Message pagination | Medium | High | **P2** |
| Presence status | Medium | Medium | **P2** |
| S3 retry logic | Low | Medium | **P2** |
| WebSocket support | High | Medium | **P3** |
| Message editing/deletion | Medium | Medium | **P3** |
| Message reactions | Medium | Low | **P3** |
| Image thumbnails | Medium | Low | **P3** |

---

## Implementation Roadmap

### Phase 1 (Week 1-2) - Foundation
- [ ] Add input validation limits
- [ ] Implement participant limits
- [ ] Add graceful shutdown
- [ ] Set up OpenAPI documentation

### Phase 2 (Week 3-4) - User Experience
- [ ] Implement typing indicators
- [ ] Add message pagination
- [ ] Add presence status

### Phase 3 (Week 5-6) - Robustness
- [ ] Add S3 retry logic
- [ ] Implement read receipts
- [ ] Add better error handling

### Phase 4 (Optional) - Advanced Features
- [ ] Consider WebSocket support
- [ ] Add message editing/deletion
- [ ] Implement reactions
- [ ] Generate image thumbnails
