# Chats3 Service - Architecture Deep Dive

This document provides a detailed technical analysis of the Chats3 architecture, data flows, and design decisions.

---

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Browser   │  │   Iframe    │  │   Mobile    │  │   API       │         │
│  │   (Direct)  │  │  (Embedded) │  │   (Future)  │  │   Client    │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER / PROXY                              │
│                        (Nginx / AWS ALB / Cloudflare)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│    Chats3 Instance   │ │    Chats3 Instance   │ │    Chats3 Instance   │
│       (PM2)          │ │       (PM2)          │ │       (PM2)          │
│                      │ │                      │ │                      │
│  ┌────────────────┐  │ │  ┌────────────────┐  │ │  ┌────────────────┐  │
│  │ In-Memory      │  │ │  │ In-Memory      │  │ │  │ In-Memory      │  │
│  │ - Sessions     │  │ │  │ - Sessions     │  │ │  │ - Sessions     │  │
│  │ - Signaling    │  │ │  │ - Signaling    │  │ │  │ - Signaling    │  │
│  │ - Nonces       │  │ │  │ - Nonces       │  │ │  │ - Nonces       │  │
│  └────────────────┘  │ │  └────────────────┘  │ │  └────────────────┘  │
└──────────┬───────────┘ └──────────┬───────────┘ └──────────┬───────────┘
           │                        │                        │
           └────────────────────────┴────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS S3                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  conversations/                                                      │    │
│  │  ├── conv-abc123/                                                   │    │
│  │  │   ├── meta.json                                                  │    │
│  │  │   ├── messages/                                                  │    │
│  │  │   │   └── 2025-12-28/                                           │    │
│  │  │   │       ├── 1735380000000-uuid1.ndjson                        │    │
│  │  │   │       └── 1735380001000-uuid2.ndjson                        │    │
│  │  │   └── attachments/                                               │    │
│  │  │       └── attachment-uuid/                                       │    │
│  │  │           ├── original                                           │    │
│  │  │           └── meta.json                                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Fastify Application Layer

```
src/app.js
    │
    ├── Plugin Registration
    │   ├── @fastify/env          → Environment configuration
    │   ├── @fastify/cookie       → Session cookies
    │   ├── @fastify/formbody     → Form parsing
    │   ├── @fastify/multipart    → File uploads
    │   ├── @fastify/rate-limit   → Request throttling
    │   ├── @fastify/static       → Static file serving
    │   └── @fastify/view         → EJS templates
    │
    ├── Middleware
    │   ├── Security headers hook
    │   └── Session validation (per-route)
    │
    └── Route Registration
        ├── viewRoutes   → HTML pages
        ├── chatRoutes   → /api/v1/* chat operations
        └── adminRoutes  → /api/v1/admin/* management
```

### 2. Module Architecture

Each module follows a consistent pattern:

```
module/
├── index.js           # Public exports (facade)
├── *-service.js       # Business logic
├── *-store.js         # Data storage
└── routes.js          # HTTP handlers (if applicable)
```

#### Module Dependency Graph

```
                    ┌─────────────┐
                    │   app.js    │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌──────────┐       ┌──────────┐
   │  chat   │       │  admin   │       │   ui     │
   │ routes  │       │  routes  │       │  routes  │
   └────┬────┘       └────┬─────┘       └────┬─────┘
        │                 │                  │
        └────────────┬────┴──────────────────┘
                     │
    ┌────────────────┼────────────────┐
    ▼                ▼                ▼
┌────────┐     ┌──────────┐     ┌──────────┐
│ session│     │  auth    │     │ message  │
│ store  │     │          │     │ service  │
└────┬───┘     └────┬─────┘     └────┬─────┘
     │              │                │
     │         ┌────┴─────┐          │
     │         ▼          ▼          │
     │    ┌────────┐ ┌────────┐      │
     │    │ nonce  │ │handshke│      │
     │    │ store  │ │        │      │
     │    └────────┘ └────────┘      │
     │                               │
     │    ┌──────────────────────────┼───────────┐
     │    ▼                          ▼           ▼
     │ ┌──────────┐           ┌──────────┐ ┌──────────┐
     │ │signaling │           │ storage  │ │attachment│
     │ │  store   │           │(S3 svc)  │ │ service  │
     │ └──────────┘           └────┬─────┘ └────┬─────┘
     │                             │            │
     └─────────────────────────────┴────────────┘
                                   │
                              ┌────┴────┐
                              │   S3    │
                              └─────────┘
```

---

## Data Models

### Session

```typescript
interface Session {
  sessionId: string;        // UUID v4
  userId: string;           // UUID v4 (from ticket or generated)
  displayName: string;      // User's display name
  avatarUrl: string | null; // Avatar URL
  role: "user" | "admin" | "system";
  conversationId: string;   // Associated conversation
  createdAt: string;        // ISO 8601
  lastActiveAt: number;     // Unix timestamp (ms)
}
```

### Conversation

```typescript
interface Conversation {
  conversationId: string;   // "conv-{uuid}" or custom ID
  joinCode: string;         // 6-char alphanumeric
  status: "active" | "closed";
  createdAt: string;        // ISO 8601
  closedAt: string | null;  // ISO 8601
  lastAccessedAt?: number;  // Unix timestamp (ms) - memory only
}
```

### Message

```typescript
interface Message {
  messageId: string;        // UUID v4
  conversationId: string;
  senderUserId: string;
  senderDisplayName: string;
  senderAvatarUrl?: string;
  senderRole: "user" | "admin" | "system";
  type: "text" | "system" | "file";
  body: string;             // Sanitized content
  clientTimestamp: string;  // ISO 8601 (client's time)
  serverReceivedAt: string; // ISO 8601 (server's time)
  
  // File message fields
  attachmentId?: string;
  filename?: string;
  mimetype?: string;
  url?: string;
}
```

### Signaling Event

```typescript
interface SignalingEvent {
  id: string;               // UUID v4
  type: "peer-join" | "peer-leave" | "offer" | "answer" | 
        "ice-candidate" | "new-message" | "end-call";
  fromUserId: string;
  toUserId: string | null;  // null = broadcast
  data: any;                // Event-specific payload
  timestamp: number;        // Unix timestamp (ms)
}
```

### Attachment

```typescript
interface AttachmentMetadata {
  attachmentId: string;     // UUID v4
  conversationId: string;
  uploaderUserId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;        // ISO 8601
  variants: null;           // Reserved for thumbnails
}
```

### Ticket (for iframe embedding)

```typescript
interface Ticket {
  integratorId: string;     // Integrator identifier
  conversationId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  role: "user" | "admin";
  origin: string;           // Embedding page origin
  issuedAt: string;         // ISO 8601
  expiresAt: string;        // ISO 8601
  nonce: string;            // Unique replay prevention token
}
```

---

## Storage Strategy

### In-Memory Storage (Volatile)

Used for ephemeral, high-frequency data:

| Store | Purpose | TTL | Cleanup |
|-------|---------|-----|---------|
| Sessions | Active user sessions | 24h | Hourly |
| Conversations (cache) | Hot conversation metadata | 24h | Hourly |
| Signaling Events | WebRTC coordination | 60s | Every minute |
| Nonces | Replay protection | 2min | Every 30s |
| Message Cache | Idempotency | 5min | Every minute |

**Trade-offs:**
- ✅ Fast access (no network latency)
- ✅ No external dependencies
- ❌ Lost on restart
- ❌ No horizontal scaling (sessions are per-instance)

### S3 Persistent Storage

Used for durable data:

| Data Type | Format | Key Pattern |
|-----------|--------|-------------|
| Conversation metadata | JSON | `conversations/{id}/meta.json` |
| Messages | NDJSON | `conversations/{id}/messages/{date}/{timestamp}-{uuid}.ndjson` |
| Attachments | Binary | `conversations/{id}/attachments/{attachmentId}/original` |
| Attachment metadata | JSON | `conversations/{id}/attachments/{attachmentId}/meta.json` |

**NDJSON Message Storage:**
```
{"messageId":"...","body":"Hello","serverReceivedAt":"..."}
{"messageId":"...","body":"World","serverReceivedAt":"..."}
```

Each batch of messages creates a new file to avoid S3 race conditions:
```
messages/
└── 2025-12-28/
    ├── 1735380000000-abc123.ndjson  # First batch
    ├── 1735380001000-def456.ndjson  # Second batch
    └── 1735380002000-ghi789.ndjson  # Third batch
```

---

## Real-Time Communication

### Server-Sent Events (SSE)

```
Client                          Server
  │                               │
  │  GET /api/v1/signaling        │
  │  Accept: text/event-stream    │
  │──────────────────────────────▶│
  │                               │
  │  HTTP 200 OK                  │
  │  Content-Type: text/event-stream
  │◀──────────────────────────────│
  │                               │
  │  retry: 3000                  │
  │  data: {"type":"system","data":"connected"}
  │◀──────────────────────────────│
  │                               │
  │                  (EventEmitter listens)
  │                               │
  │  data: {"type":"new-message"...}
  │◀──────────────────────────────│
  │                               │
  │  : heartbeat                  │  (every 15s)
  │◀──────────────────────────────│
  │                               │
  │  (connection close)           │
  │──────────────────────────────▶│
  │                               │
  │                  (cleanup listener)
```

**SSE Implementation Details:**

```javascript
// Server-side (chat/routes.js)
fastify.get("/signaling", async (request, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  // Disable nginx buffering
  });

  // Subscribe to conversation events
  const onEvent = (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  
  signalingEmitter.on(`event-${conversationId}`, onEvent);
  
  // Keep connection alive
  const heartbeat = setInterval(() => {
    reply.raw.write(": heartbeat\n\n");
  }, 15000);
  
  // Cleanup on disconnect
  request.raw.on("close", () => {
    signalingEmitter.off(`event-${conversationId}`, onEvent);
    clearInterval(heartbeat);
  });
  
  // Return pending promise to keep connection open
  return new Promise(() => {});
});
```

### WebRTC Signaling Flow

```
  User A (Caller)           Server              User B (Callee)
       │                      │                       │
       │  peer-join           │                       │
       │─────────────────────▶│                       │
       │                      │  peer-join            │
       │                      │──────────────────────▶│
       │                      │                       │
       │                      │                       │ createPeerConnection()
       │                      │                       │ createOffer()
       │                      │                       │
       │                      │  offer                │
       │◀─────────────────────│◀──────────────────────│
       │                      │                       │
       │ setRemoteDescription()                       │
       │ createAnswer()       │                       │
       │                      │                       │
       │  answer              │                       │
       │─────────────────────▶│  answer               │
       │                      │──────────────────────▶│
       │                      │                       │
       │                      │                       │ setRemoteDescription()
       │                      │                       │
       │  ice-candidate       │                       │
       │◀────────────────────▶│◀─────────────────────▶│
       │  (bidirectional)     │                       │
       │                      │                       │
       ├──────────────────────┼───────────────────────┤
       │           P2P Connection Established          │
       └──────────────────────┴───────────────────────┘
```

---

## Security Architecture

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AUTHENTICATION FLOWS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ FLOW 1: Manual Join (Join Code)                                     │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  User ──▶ GET /join page                                            │    │
│  │       ──▶ Enter: conversationId + joinCode + displayName            │    │
│  │       ──▶ POST /api/v1/join                                         │    │
│  │           │                                                          │    │
│  │           ├── Validate joinCode matches conversation                 │    │
│  │           ├── Check displayName uniqueness                           │    │
│  │           ├── Create session                                         │    │
│  │           ├── Set sessionId cookie                                   │    │
│  │           └── Return session details                                 │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ FLOW 2: Iframe Embedding (Signed Ticket)                            │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │                                                                      │    │
│  │  Integrator Backend:                                                 │    │
│  │       ──▶ Create ticket JSON                                        │    │
│  │       ──▶ Sign with HMAC-SHA256(secret, ticket)                     │    │
│  │       ──▶ Render iframe: /embed?ticket=...&signature=...            │    │
│  │                                                                      │    │
│  │  Browser (iframe):                                                   │    │
│  │       ──▶ GET /embed?ticket=...&signature=...                       │    │
│  │           │                                                          │    │
│  │           ├── Parse ticket JSON                                      │    │
│  │           ├── Lookup integrator by ID                                │    │
│  │           ├── Verify HMAC signature                                  │    │
│  │           ├── Check ticket expiry (< 60s)                            │    │
│  │           ├── Validate origin in allowedOrigins                      │    │
│  │           ├── Check nonce (replay protection)                        │    │
│  │           ├── Create session                                         │    │
│  │           ├── Set sessionId cookie                                   │    │
│  │           └── Redirect to /room/{conversationId}                     │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Request Authentication

```
Incoming Request
       │
       ▼
┌─────────────────┐
│ Check Session   │
├─────────────────┤
│ 1. x-session-id │──▶ Header (for multi-tab/iframe)
│    header       │
├─────────────────┤
│ 2. sessionId    │──▶ Query param (for SSE)
│    query        │
├─────────────────┤
│ 3. sessionId    │──▶ Cookie (default)
│    cookie       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Lookup Session  │
│ in memory store │
└────────┬────────┘
         │
    ┌────┴────┐
    │ Found?  │
    └────┬────┘
    No   │   Yes
    │    │    │
    ▼    │    ▼
┌──────┐ │ ┌──────────────┐
│ 401  │ │ │ Update       │
│      │ │ │ lastActiveAt │
└──────┘ │ └──────────────┘
         │         │
         │         ▼
         │ ┌──────────────┐
         │ │ Attach to    │
         │ │ request.sess │
         │ └──────────────┘
         │         │
         │         ▼
         │    Continue
```

---

## Scalability Considerations

### Current Limitations

1. **In-Memory Sessions**
   - Sessions are per-instance
   - No session sharing between instances
   - Requires sticky sessions or session replication

2. **SSE Connections**
   - Each instance maintains its own connections
   - Events only broadcast to local subscribers
   - Need Redis Pub/Sub for multi-instance

3. **No Connection Pooling**
   - S3 client created per-instance
   - Adequate for moderate load

### Scaling Strategies

#### Option 1: Sticky Sessions (Simplest)

```
Load Balancer (cookie-based routing)
         │
    ┌────┴────┐
    ▼         ▼
Instance A  Instance B
(users 1-3) (users 4-6)
```

- Use load balancer session affinity
- Route by `sessionId` cookie
- Simple but reduces load distribution

#### Option 2: Redis Session Store (Recommended)

```
         ┌─────────────┐
         │   Redis     │
         │  Sessions   │
         │  Signaling  │
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
Instance A  Instance B  Instance C
```

Implementation changes needed:
```javascript
// session-store.js with Redis
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

export async function createSession(data) {
  const sessionId = crypto.randomUUID();
  await redis.setex(
    `session:${sessionId}`,
    86400, // 24h TTL
    JSON.stringify({ sessionId, ...data })
  );
  return { sessionId, ...data };
}

export async function getSession(sessionId) {
  const data = await redis.get(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}
```

```javascript
// signaling with Redis Pub/Sub
const redisPub = new Redis(process.env.REDIS_URL);
const redisSub = new Redis(process.env.REDIS_URL);

export function addSignalingEvent(conversationId, event) {
  redisPub.publish(`conv:${conversationId}`, JSON.stringify(event));
  // Local emit for this instance's SSE connections
  signalingEmitter.emit(`event-${conversationId}`, event);
}

// Subscribe to Redis for events from other instances
redisSub.psubscribe("conv:*");
redisSub.on("pmessage", (pattern, channel, message) => {
  const conversationId = channel.split(":")[1];
  const event = JSON.parse(message);
  signalingEmitter.emit(`event-${conversationId}`, event);
});
```

#### Option 3: WebSocket Gateway

For very high scale, use a dedicated WebSocket gateway:

```
Clients
   │
   ▼
┌─────────────────────┐
│ WebSocket Gateway   │◀──▶ Redis Pub/Sub
│ (Socket.io/uWS)     │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
API Server A  API Server B
(HTTP only)   (HTTP only)
```

---

## Performance Characteristics

### Latency Profile

| Operation | Expected Latency | Notes |
|-----------|-----------------|-------|
| Session lookup | <1ms | In-memory Map |
| Message save | 50-200ms | S3 write |
| Message history | 100-500ms | S3 reads (multiple files) |
| Attachment upload | 100-500ms | S3 write |
| SSE event delivery | <10ms | In-process EventEmitter |
| WebRTC signaling | <20ms | SSE + EventEmitter |

### Memory Usage

| Component | Per-Unit | Notes |
|-----------|----------|-------|
| Session | ~500 bytes | JSON object in Map |
| Signaling event | ~200 bytes | TTL: 60s |
| Message cache | ~500 bytes | TTL: 5 minutes |
| SSE connection | ~2-5 KB | Per-client overhead |

Estimated memory for 1000 active users:
- Sessions: ~500 KB
- Signaling: ~200 KB (avg 1000 events)
- SSE connections: ~5 MB
- **Total: ~6 MB** (excluding Node.js overhead)

### Throughput

| Endpoint | Expected RPS | Bottleneck |
|----------|-------------|------------|
| Health check | 10,000+ | CPU |
| Session lookup | 5,000+ | CPU |
| Message send | 500-1,000 | S3 writes |
| SSE connections | 1,000-5,000 | Memory/File descriptors |

---

## Error Handling Strategy

### Error Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ERROR HANDLING                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │ Validation Errors   │ → 400 Bad Request                                  │
│  │ (Zod)               │   Detailed field errors in response                │
│  └─────────────────────┘                                                    │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │ Auth Errors         │ → 401 Unauthorized (no session)                    │
│  │                     │ → 403 Forbidden (access denied)                    │
│  └─────────────────────┘                                                    │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │ Not Found           │ → 404 Not Found                                    │
│  │                     │   Conversation, attachment, etc.                   │
│  └─────────────────────┘                                                    │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │ Conflict            │ → 409 Conflict                                     │
│  │                     │   Duplicate display name, etc.                     │
│  └─────────────────────┘                                                    │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │ Rate Limit          │ → 429 Too Many Requests                            │
│  │                     │   Retry-After header                               │
│  └─────────────────────┘                                                    │
│                                                                              │
│  ┌─────────────────────┐                                                    │
│  │ S3 Errors           │ → Logged + 500 Internal Error                      │
│  │                     │   (Consider retry logic)                           │
│  └─────────────────────┘                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Error Handler

```javascript
app.setErrorHandler((error, request, reply) => {
  // Log all errors
  request.log.error({
    err: error,
    url: request.url,
    method: request.method,
    sessionId: request.session?.sessionId,
  });

  // Determine status code
  let statusCode = error.statusCode || 500;
  let message = error.message;

  // Handle Zod validation errors
  if (error.name === "ZodError") {
    statusCode = 400;
    return reply.status(statusCode).send({
      success: false,
      message: "Validation error",
      details: error.errors,
      meta: getMeta(),
    });
  }

  // Handle S3 errors
  if (error.name === "NoSuchKey") {
    statusCode = 404;
    message = "Resource not found";
  }

  // Don't expose internal errors in production
  if (statusCode === 500 && process.env.NODE_ENV === "production") {
    message = "Internal server error";
  }

  return reply.status(statusCode).send({
    success: false,
    message,
    meta: getMeta(),
  });
});
```

---

## Testing Architecture

```
tests/
├── run.js                  # Test runner (Node test API)
├── api.test.js             # Integration tests (HTTP)
├── auth.test.js            # Authentication tests
├── conversation.test.js    # Conversation lifecycle
├── message.test.js         # Message operations
├── session.test.js         # Session management
├── signaling.test.js       # WebRTC signaling
└── iframe/
    └── test-server.js      # Iframe embedding tests
```

### Test Strategy

| Test Type | Coverage | Tools |
|-----------|----------|-------|
| Unit | Utility functions | Node test |
| Integration | API endpoints | Fastify inject |
| E2E | Full flows | (Future: Playwright) |

### Running Tests

```bash
# Run all tests
yarn test

# Tests use buildApp() with { logger: false }
# No actual S3 needed (will fail gracefully)
```
