# Chats3 Service - API Reference

Complete API documentation for the Chats3 real-time chat microservice.

---

## Base URL

```
Development: http://localhost:3000
Production:  https://your-domain.com
```

---

## Authentication

Chats3 supports two authentication methods:

### 1. Session Cookie (Primary)
After joining a conversation, a `sessionId` cookie is set automatically.

### 2. Session Header (For Multi-tab/Iframe)
Include the session ID in requests:
```
x-session-id: <session-id>
```

### 3. Ticket-Based (Iframe Embedding)
For iframe integration, use HMAC-signed tickets. See [Embedding Guide](#iframe-embedding).

---

## Response Format

All API responses follow this structure:

### Success Response
```json
{
  "success": true,
  "message": "Operation completed",
  "details": { ... },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-12-28T10:00:00.000Z"
  }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "details": { ... },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-12-28T10:00:00.000Z"
  }
}
```

---

## Endpoints

### Health Check

#### `GET /health`

Check service health.

**Authentication:** None

**Response:**
```json
{
  "status": "ok",
  "service": "chats3"
}
```

---

### Session Management

#### `POST /api/v1/join`

Join a conversation manually using a join code.

**Authentication:** None (creates new session)

**Request Body:**
```json
{
  "conversationId": "conv-abc123",
  "joinCode": "ABC123",
  "displayName": "John Doe",
  "avatarUrl": "https://example.com/avatar.jpg"  // optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Joined conversation",
  "details": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "660e8400-e29b-41d4-a716-446655440001",
    "conversationId": "conv-abc123"
  }
}
```

**Errors:**
| Status | Message |
|--------|---------|
| 400 | Validation error |
| 403 | Invalid conversation or join code |
| 409 | Display name is already taken |

---

#### `POST /api/v1/embed`

Authenticate via signed ticket (for iframe embedding).

**Authentication:** Ticket + Signature

**Request Body:**
```json
{
  "ticket": "{\"integratorId\":\"acme\",\"conversationId\":\"conv-123\",...}",
  "signature": "base64url-encoded-hmac-signature"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Session created",
  "details": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "conversationId": "conv-123"
  }
}
```

**Errors:**
| Status | Message |
|--------|---------|
| 400 | Validation error |
| 403 | Invalid signature / Ticket expired / Origin not allowed |

---

#### `POST /api/v1/leave`

Leave the current conversation.

**Authentication:** Session required

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `keepSession` | boolean | If `true`, don't delete session (for tab close) |

**Response:**
```json
{
  "success": true,
  "message": "Left conversation"
}
```

---

#### `GET /api/v1/session`

Get current session information.

**Authentication:** Session required

**Response:**
```json
{
  "success": true,
  "message": "Session retrieved",
  "details": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "660e8400-e29b-41d4-a716-446655440001",
    "displayName": "John Doe",
    "avatarUrl": "https://example.com/avatar.jpg",
    "role": "user",
    "conversationId": "conv-abc123",
    "createdAt": "2025-12-28T10:00:00.000Z",
    "lastActiveAt": 1735380000000
  }
}
```

---

### Conversations

#### `GET /api/v1/conversation`

Get current conversation information.

**Authentication:** Session required

**Response:**
```json
{
  "success": true,
  "message": "Conversation retrieved",
  "details": {
    "conversationId": "conv-abc123",
    "joinCode": "ABC123",
    "status": "active",
    "createdAt": "2025-12-28T09:00:00.000Z",
    "closedAt": null
  }
}
```

---

### Messages

#### `POST /api/v1/messages`

Send a message to the conversation.

**Authentication:** Session required

**Request Body:**
```json
{
  "messageId": "770e8400-e29b-41d4-a716-446655440002",  // optional, generated if not provided
  "type": "text",  // "text" | "system" | "file"
  "body": "Hello, world!",
  "clientTimestamp": "2025-12-28T10:00:00.000Z",
  "attachmentId": "...",  // for file messages
  "filename": "...",      // for file messages
  "mimetype": "...",      // for file messages
  "url": "..."            // for file messages
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message saved",
  "details": {
    "messageId": "770e8400-e29b-41d4-a716-446655440002",
    "conversationId": "conv-abc123",
    "senderUserId": "660e8400-e29b-41d4-a716-446655440001",
    "senderDisplayName": "John Doe",
    "senderAvatarUrl": "https://example.com/avatar.jpg",
    "senderRole": "user",
    "type": "text",
    "body": "Hello, world!",
    "clientTimestamp": "2025-12-28T10:00:00.000Z",
    "serverReceivedAt": "2025-12-28T10:00:00.123Z"
  }
}
```

---

#### `GET /api/v1/messages`

Get message history for the conversation.

**Authentication:** Session required

**Response:**
```json
{
  "success": true,
  "message": "Messages retrieved",
  "details": [
    {
      "messageId": "...",
      "conversationId": "conv-abc123",
      "senderUserId": "...",
      "senderDisplayName": "John Doe",
      "type": "text",
      "body": "Hello!",
      "clientTimestamp": "2025-12-28T10:00:00.000Z",
      "serverReceivedAt": "2025-12-28T10:00:00.123Z"
    }
    // ... up to 100 messages
  ]
}
```

---

### Signaling (WebRTC)

#### `POST /api/v1/signaling`

Send a signaling event for WebRTC coordination.

**Authentication:** Session required

**Request Body:**
```json
{
  "type": "offer",  // See event types below
  "toUserId": "target-user-id",  // optional, null for broadcast
  "data": { ... }  // Event-specific payload
}
```

**Event Types:**
| Type | Description | Data |
|------|-------------|------|
| `peer-join` | User joined | `{ userId, displayName }` |
| `peer-leave` | User left | `{}` |
| `offer` | WebRTC offer | SDP offer object |
| `answer` | WebRTC answer | SDP answer object |
| `ice-candidate` | ICE candidate | ICE candidate object |
| `new-message` | New message | Message object |
| `end-call` | End video call | `{}` |

**Response:**
```json
{
  "success": true,
  "message": "Signaling event added",
  "details": {
    "eventId": "880e8400-e29b-41d4-a716-446655440003"
  }
}
```

---

#### `GET /api/v1/signaling`

Subscribe to signaling events via Server-Sent Events (SSE).

**Authentication:** Session required

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `cursor` | string | Resume from cursor position |
| `sessionId` | string | Alternative to cookie (for SSE) |

**Response:** SSE stream

```
retry: 3000

data: {"type":"system","data":"connected"}

data: {"type":"peer-join","fromUserId":"...","data":{"displayName":"Jane"}}

data: {"type":"new-message","fromUserId":"...","data":{...message object...}}
```

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

---

### Attachments

#### `POST /api/v1/attachments`

Upload a file attachment.

**Authentication:** Session required

**Request:** `multipart/form-data`

**Limits:**
- Max file size: 10MB
- Allowed types: JPEG, PNG, GIF, WebP, PDF, TXT, DOC, DOCX

**Response:**
```json
{
  "success": true,
  "message": "Attachment uploaded",
  "details": {
    "attachmentId": "990e8400-e29b-41d4-a716-446655440004",
    "originalFilename": "document.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 1024000
  }
}
```

**Errors:**
| Status | Message |
|--------|---------|
| 400 | No file uploaded |
| 400 | File type not allowed |
| 400 | Invalid file content (magic number mismatch) |
| 400 | File too large |

---

#### `GET /api/v1/attachments/:attachmentId`

Get attachment metadata and signed download URL.

**Authentication:** Session required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `attachmentId` | string | Attachment UUID |

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `download` | boolean | If `true`, redirect to download URL |

**Response:**
```json
{
  "success": true,
  "message": "Attachment retrieved",
  "details": {
    "metadata": {
      "attachmentId": "990e8400-e29b-41d4-a716-446655440004",
      "conversationId": "conv-abc123",
      "uploaderUserId": "660e8400-e29b-41d4-a716-446655440001",
      "originalFilename": "document.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 1024000,
      "createdAt": "2025-12-28T10:00:00.000Z"
    },
    "signedUrl": "https://s3.../document.pdf?X-Amz-..."
  }
}
```

---

### Admin Operations

#### `POST /api/v1/admin/conversations`

Create a new conversation.

**Authentication:** Admin password

**Rate Limit:** 10 requests per minute

**Request Body:**
```json
{
  "adminPassword": "your-admin-password",
  "conversationId": "custom-conv-id"  // optional, generated if not provided
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation created",
  "details": {
    "conversationId": "conv-abc123",
    "joinCode": "ABC123",
    "status": "active",
    "createdAt": "2025-12-28T10:00:00.000Z"
  }
}
```

---

#### `POST /api/v1/admin/conversations/:conversationId`

Get conversation details.

**Authentication:** Admin password

**Rate Limit:** 10 requests per minute

**Request Body:**
```json
{
  "adminPassword": "your-admin-password"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation retrieved",
  "details": {
    "conversationId": "conv-abc123",
    "joinCode": "ABC123",
    "status": "active",
    "createdAt": "2025-12-28T10:00:00.000Z"
  }
}
```

---

#### `POST /api/v1/admin/conversations/:conversationId/close`

Close a conversation (prevents new joins).

**Authentication:** Admin password

**Rate Limit:** 10 requests per minute

**Request Body:**
```json
{
  "adminPassword": "your-admin-password"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation closed",
  "details": {
    "conversationId": "conv-abc123",
    "status": "closed",
    "closedAt": "2025-12-28T12:00:00.000Z"
  }
}
```

---

## View Routes (HTML Pages)

| Route | Description |
|-------|-------------|
| `GET /` | Redirect to `/join` |
| `GET /join` | Join conversation page |
| `GET /room/:conversationId` | Chat room page |
| `GET /admin` | Admin management page |
| `GET /embed?ticket=...&signature=...` | Iframe entry point |

---

## Iframe Embedding

### Ticket Structure

```json
{
  "integratorId": "acme-corp",
  "conversationId": "conv-123",
  "userId": "user-456",
  "displayName": "John Doe",
  "avatarUrl": "https://example.com/avatar.jpg",
  "role": "user",
  "origin": "https://acme.com",
  "issuedAt": "2025-12-28T10:00:00.000Z",
  "expiresAt": "2025-12-28T10:01:00.000Z",
  "nonce": "random-unique-string"
}
```

### Signature Generation

```javascript
const crypto = require("crypto");

const ticket = JSON.stringify(ticketData);
const signature = crypto
  .createHmac("sha256", integratorSecret)
  .update(ticket)
  .digest("base64url");
```

### Embedding

```html
<iframe 
  src="https://chat.example.com/embed?ticket=${encodeURIComponent(ticket)}&signature=${signature}"
  width="400"
  height="600"
  allow="camera; microphone; display-capture"
></iframe>
```

### Integrator Configuration

Edit `src/constants/index.js`:

```javascript
export const INTEGRATORS = [
  {
    id: "acme-corp",
    secret: "256-bit-secret-key-here",
    allowedOrigins: ["https://acme.com", "https://app.acme.com"],
  },
];
```

---

## Rate Limits

| Scope | Limit | Window |
|-------|-------|--------|
| Global | 100 requests | 1 minute |
| Admin endpoints | 10 requests | 1 minute |

When rate limited, response:
```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded"
}
```

---

## Error Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (no/invalid session) |
| 403 | Forbidden (access denied) |
| 404 | Not Found |
| 409 | Conflict (duplicate resource) |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

---

## WebSocket Events Reference

Events sent via SSE `/api/v1/signaling`:

### System Events

```json
{
  "type": "system",
  "data": "connected"
}
```

### Peer Events

```json
{
  "type": "peer-join",
  "fromUserId": "user-123",
  "data": {
    "userId": "user-123",
    "displayName": "John Doe"
  }
}
```

```json
{
  "type": "peer-leave",
  "fromUserId": "user-123",
  "data": {}
}
```

### Message Events

```json
{
  "type": "new-message",
  "fromUserId": "user-123",
  "data": {
    "messageId": "...",
    "senderDisplayName": "John Doe",
    "type": "text",
    "body": "Hello!",
    "serverReceivedAt": "..."
  }
}
```

### WebRTC Events

```json
{
  "type": "offer",
  "fromUserId": "user-123",
  "toUserId": "user-456",
  "data": { "sdp": "...", "type": "offer" }
}
```

```json
{
  "type": "answer",
  "fromUserId": "user-456",
  "toUserId": "user-123",
  "data": { "sdp": "...", "type": "answer" }
}
```

```json
{
  "type": "ice-candidate",
  "fromUserId": "user-123",
  "toUserId": "user-456",
  "data": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 }
}
```

```json
{
  "type": "end-call",
  "fromUserId": "user-123",
  "data": {}
}
```
