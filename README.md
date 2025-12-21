# Chats3 Service

A standalone, production-grade WebRTC chat microservice with S3-based persistent storage, designed for secure peer-to-peer communication.

## Overview

Chats3 provides secure, real-time chat functionality with the following key features:

- **WebRTC DataChannels** for low-latency peer-to-peer communication
- **HTTP-based signaling** (no WebSockets required)
- **S3-compatible storage** for persistent message history
- **Admin password-based controls** (no database required)
- **iframe embedding support** with cryptographic handshake
- **Cookie-based sessions** with HMAC validation
- **Comprehensive security** (XSS prevention, CSP, rate limiting, HSTS)

## Tech Stack

- **Language**: JavaScript (ES Modules)
- **Framework**: Fastify
- **Validation**: Zod
- **Process Manager**: PM2
- **Storage**: AWS S3 (or S3-compatible service)
- **View Engine**: EJS
- **Testing**: Node.js built-in test runner

## Architecture

```
Browser A  ←── WebRTC ──→  Browser B
    │                        │
    └──── HTTPS ────────────┘
              │
          Fastify
              │
        Private S3 Storage
```

### Key Principles

- **WebRTC is for realtime only** - messages are immediately sent peer-to-peer
- **Backend is the single source of truth** - all messages are persisted to S3
- **No database required** - uses in-memory stores for sessions and signaling
- **Single instance in v1** - horizontal scaling not supported yet

## Getting Started

### Prerequisites

- Node.js (v18+)
- Yarn package manager
- S3-compatible storage (AWS S3, MinIO, etc.)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/adelhamad/chats3.git
   cd chats3
   ```

2. Install dependencies:
   ```bash
   yarn install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

### Environment Variables

#### Required Variables

```bash
# Server Configuration
PORT=3000                          # Server port
HOST=0.0.0.0                       # Server host
BASE_URL=http://localhost:3000     # Public base URL

# Security
COOKIE_SECRET=<random-32-char-string>  # Cookie signing secret (min 32 chars)
ADMIN_PASSWORD=<your-admin-password>   # Admin password for creating conversations

# S3 Storage Configuration
S3_ENDPOINT=https://s3.amazonaws.com   # S3 endpoint URL
S3_REGION=us-east-1                    # S3 region
S3_BUCKET=chats3-storage               # S3 bucket name
S3_ACCESS_KEY=<your-access-key>        # S3 access key (optional if using IAM)
S3_SECRET_KEY=<your-secret-key>        # S3 secret key (optional if using IAM)

# Integrators (JSON array of allowed iframe integrators)
INTEGRATORS_JSON=[{"id":"integrator1","secret":"secret123","allowedOrigins":["https://example.com"]}]
```

#### Optional Variables

```bash
NODE_ENV=development  # Environment (development|production)
```

### Development

Start the development server with hot reload:
```bash
yarn run dev
```

The server will start on `http://localhost:3000` (or the port specified in your `.env`).

View logs:
```bash
yarn pm2 logs
```

Stop the server:
```bash
yarn run stop
```

### Production

Start in production mode:
```bash
yarn run start
```

### Testing

Run all tests:
```bash
yarn test
```

Tests use Node.js built-in test runner and cover:
- Session management
- Conversation lifecycle
- Message sanitization (XSS prevention)
- Admin authentication
- iframe handshake validation
- Signaling flow
- API endpoints
- Security headers
- Rate limiting

Note: S3-dependent tests will skip gracefully if S3 credentials are not configured.

### Linting

```bash
yarn run lint
```

## API Endpoints

### Public Routes

#### GET /
Redirects to `/join`

#### GET /join
Join page for manual conversation entry

#### GET /room/:conversationId
Chat room interface

### API Routes

#### POST /api/v1/join
Join a conversation manually

**Request:**
```json
{
  "conversationId": "conv-123",
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
    "sessionId": "...",
    "userId": "...",
    "conversationId": "conv-123"
  }
}
```

#### POST /api/v1/embed
iframe embedding handshake

**Request:**
```json
{
  "ticket": "<base64-encoded-ticket>",
  "signature": "<hmac-signature>"
}
```

#### POST /api/v1/messages
Save a message (requires session)

**Request:**
```json
{
  "messageId": "msg-123",  // optional, auto-generated if omitted
  "type": "text",
  "body": "Hello world",
  "clientTimestamp": "2025-01-01T12:00:00Z"
}
```

#### POST /api/v1/messages/batch
Batch save messages (for flush on page close)

**Request:**
```json
{
  "messages": [
    {
      "type": "text",
      "body": "Message 1",
      "clientTimestamp": "2025-01-01T12:00:00Z"
    }
  ]
}
```

#### GET /api/v1/messages
Get message history (requires session)

#### POST /api/v1/signaling
Send WebRTC signaling event (requires session)

**Request:**
```json
{
  "type": "offer|answer|ice-candidate|peer-join|peer-leave",
  "toUserId": "user-456",  // optional, broadcast if omitted
  "data": { /* event-specific data */ }
}
```

#### GET /api/v1/signaling?cursor=...
Poll for signaling events (requires session)

#### POST /api/v1/attachments
Upload a file attachment (requires session)

**Request:** multipart/form-data with file

#### GET /api/v1/attachments/:attachmentId
Get attachment signed URL (requires session)

### Admin Routes

All admin routes require `adminPassword` in the request body.

#### POST /api/v1/admin/conversations
Create a new conversation

**Request:**
```json
{
  "adminPassword": "your-admin-password",
  "conversationId": "custom-id"  // optional, auto-generated if omitted
}
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation created",
  "details": {
    "conversationId": "conv-123",
    "joinCode": "ABC123",
    "status": "active",
    "createdAt": "2025-01-01T12:00:00Z"
  }
}
```

#### POST /api/v1/admin/conversations/:conversationId
Get conversation details

#### POST /api/v1/admin/conversations/:conversationId/close
Close a conversation

## iframe Integration

### Overview

External systems can embed chat rooms via iframe using a secure handshake mechanism.

### Setup

1. Add your integrator to `INTEGRATORS_JSON`:
```json
[
  {
    "id": "my-app",
    "secret": "shared-secret-key",
    "allowedOrigins": ["https://my-app.com"]
  }
]
```

2. Generate a handshake ticket (in your backend):
```javascript
const crypto = require('crypto');

const ticket = {
  integratorId: 'my-app',
  conversationId: 'conv-123',
  userId: 'user-456',
  displayName: 'John Doe',
  avatarUrl: 'https://example.com/avatar.jpg',  // optional
  role: 'user',  // or 'admin'
  origin: 'https://my-app.com',
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),  // 60 seconds
  nonce: crypto.randomUUID()
};

const ticketJson = JSON.stringify(ticket);
const signature = crypto
  .createHmac('sha256', 'shared-secret-key')
  .update(ticketJson)
  .digest('base64url');
```

3. Embed the iframe:
```html
<iframe
  src="https://chats3.example.com/embed?ticket=...&signature=..."
  width="100%"
  height="600"
  frameborder="0"
></iframe>
```

### Security Considerations

- **Tickets expire after 60 seconds** - generate them just-in-time
- **Nonces prevent replay attacks** - each ticket can only be used once
- **Origin validation** - only allowed origins can embed
- **HMAC signatures** - prevent ticket tampering

## Security Features

### XSS Prevention
- All message bodies are sanitized server-side (HTML tags removed)
- EJS templates auto-escape all dynamic content
- Strict Content-Security-Policy headers

### Session Security
- HttpOnly cookies (not accessible via JavaScript)
- Secure flag in production
- SameSite=None for iframe support
- Short-lived sessions (24 hours)

### Rate Limiting
- 100 requests per minute per IP
- Applied to all endpoints

### HTTPS/HSTS
- HSTS headers in production
- Secure cookies only over HTTPS

### Admin Controls
- No persistent admin sessions
- Password required for each admin action
- Admin password stored as environment variable

## Storage Structure (S3)

```
conversations/
  {conversationId}/
    meta.json
    messages/
      2025-01-21/
        part-0001.ndjson
        part-0002.ndjson
    attachments/
      {attachmentId}/
        original
        meta.json
```

### Message Format (NDJSON)

Each line is a JSON object:
```json
{"messageId":"msg-1","conversationId":"conv-1","senderUserId":"user-1","senderDisplayName":"John","senderRole":"user","type":"text","body":"Hello","clientTimestamp":"2025-01-01T12:00:00Z","serverReceivedAt":"2025-01-01T12:00:01Z"}
{"messageId":"msg-2","conversationId":"conv-1","senderUserId":"user-2","senderDisplayName":"Jane","senderRole":"user","type":"text","body":"Hi","clientTimestamp":"2025-01-01T12:00:02Z","serverReceivedAt":"2025-01-01T12:00:03Z"}
```

## Limitations (Documented)

- **Single instance only** - no horizontal scaling in v1
- **No TURN server** - NAT traversal depends on STUN (works for most users)
- **No message editing** - messages are append-only
- **No message search** - use S3 exports for archival search
- **Max 3 peers** - designed for 1-to-1 chat with optional admin

## Project Structure

```
chats3/
├── src/
│   ├── app.js                 # Main application entry
│   ├── config/                # Environment configuration
│   ├── constants/             # Response helpers
│   ├── middleware/            # Session validation
│   └── modules/
│       ├── admin/             # Admin routes
│       ├── attachment/        # File upload handling
│       ├── auth/              # Handshake & nonce validation
│       ├── chat/              # Main chat routes
│       ├── conversation/      # Conversation management
│       ├── message/           # Message persistence
│       ├── session/           # Session store
│       ├── signaling/         # WebRTC signaling
│       ├── storage/           # S3 service
│       └── views/             # View routes
├── views/                     # EJS templates
├── public/                    # Static assets
│   ├── css/
│   └── js/
└── tests/                     # Test suite
```

## Development Guidelines

- Use **async/await** for all asynchronous operations
- Validate all request inputs using **Zod** schemas
- Keep modules self-contained with clear exports
- Follow existing code style (ESLint configured)
- Use **yarn** (never npm)
- Process management via `yarn pm2`

## Contributing

This is a demonstration project for secure chat architecture. Contributions welcome!

## License

ISC