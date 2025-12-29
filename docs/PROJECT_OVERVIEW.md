# Chats3 Service - Project Overview

## What is Chats3?

Chats3 is a **real-time chat microservice** designed to be embedded via iframes in third-party applications. It provides a complete chat solution with video/audio calling capabilities, file sharing, and secure authentication.

## Core Use Cases

### 1. Embeddable Chat Widget
Third-party websites can embed Chats3 as an iframe to provide real-time communication features to their users. The integration uses a secure ticket-based handshake system.

### 2. Standalone Chat Rooms
Users can create and join chat rooms using simple join codes, without requiring any integration.

### 3. Video Conferencing
Peer-to-peer WebRTC video and audio calls with screen sharing support.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│  Browser (room.js)                                               │
│  ├── Chat UI                                                     │
│  ├── WebRTC Engine (peer-to-peer video/audio)                   │
│  ├── SSE Client (real-time updates)                             │
│  └── File Upload/Download                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API LAYER (Fastify)                       │
├─────────────────────────────────────────────────────────────────┤
│  Routes                                                          │
│  ├── /api/v1/join          - Manual room join                   │
│  ├── /api/v1/embed         - Iframe handshake                   │
│  ├── /api/v1/messages      - Send/receive messages              │
│  ├── /api/v1/signaling     - WebRTC signaling (SSE)             │
│  ├── /api/v1/attachments   - File upload/download               │
│  ├── /api/v1/admin/*       - Conversation management            │
│  └── /api/v1/session       - Session info                       │
│                                                                  │
│  Middleware                                                      │
│  ├── Rate Limiting (100 req/min)                                │
│  ├── Session Validation                                          │
│  └── Security Headers                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  Modules                                                         │
│  ├── auth/         - Ticket validation, nonce store             │
│  ├── session/      - In-memory session management               │
│  ├── conversation/ - Conversation lifecycle                     │
│  ├── message/      - Message processing & sanitization          │
│  ├── signaling/    - WebRTC signaling events                    │
│  ├── attachment/   - File upload validation                     │
│  └── storage/      - S3 persistence                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  In-Memory (volatile)              │  S3 (persistent)           │
│  ├── Sessions                      │  ├── Conversation metadata │
│  ├── Signaling events              │  ├── Messages (NDJSON)     │
│  └── Nonces (replay protection)    │  └── Attachments           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Category | Technology | Purpose |
|----------|------------|---------|
| **Runtime** | Node.js (ES Modules) | JavaScript runtime |
| **Framework** | Fastify 5.x | High-performance web framework |
| **Validation** | Zod 4.x | Schema validation |
| **Storage** | AWS S3 | Message and attachment persistence |
| **View Engine** | EJS | Server-side templates |
| **Process Manager** | PM2 | Production process management |
| **Real-time** | SSE (Server-Sent Events) | Live updates & signaling |
| **P2P Communication** | WebRTC | Video/audio/data channels |

### Key Dependencies

```json
{
  "@aws-sdk/client-s3": "File storage",
  "@fastify/cookie": "Session management",
  "@fastify/cors": "Cross-origin requests",
  "@fastify/multipart": "File uploads",
  "@fastify/rate-limit": "Request throttling",
  "@fastify/static": "Static file serving",
  "@fastify/view": "Template rendering",
  "file-type": "Magic number validation",
  "sanitize-html": "XSS prevention"
}
```

---

## Module Structure

```
src/
├── app.js                    # Application entry point
├── config/
│   └── index.js              # Environment configuration
├── constants/
│   ├── index.js              # Re-exports
│   └── response.js           # Standardized API responses
├── middleware/
│   ├── index.js              # Re-exports
│   └── session.js            # Session validation middleware
└── modules/
    ├── admin/                # Admin operations
    │   ├── index.js
    │   └── routes.js
    ├── attachment/           # File handling
    │   ├── index.js
    │   └── attachment-service.js
    ├── auth/                 # Authentication
    │   ├── index.js
    │   ├── handshake.js      # Ticket validation
    │   └── nonce-store.js    # Replay protection
    ├── chat/                 # Main chat routes
    │   ├── index.js
    │   └── routes.js
    ├── conversation/         # Conversation management
    │   ├── index.js
    │   └── conversation-store.js
    ├── message/              # Message processing
    │   ├── index.js
    │   └── message-service.js
    ├── session/              # Session management
    │   ├── index.js
    │   └── session-store.js
    ├── signaling/            # WebRTC signaling
    │   ├── index.js
    │   └── signaling-store.js
    ├── storage/              # S3 operations
    │   ├── index.js
    │   └── s3-service.js
    └── ui/                   # Frontend views
        ├── index.js
        ├── routes.js
        ├── public/           # Static assets
        │   ├── css/
        │   └── js/
        └── views/            # EJS templates
```

---

## Data Flow

### 1. Iframe Embedding Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Integrator  │     │   Chats3     │     │   Browser    │
│   Backend    │     │   Service    │     │   (iframe)   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. Create ticket   │                    │
       │    (signed HMAC)   │                    │
       │                    │                    │
       │ 2. Render iframe   │                    │
       │    with ticket URL ─────────────────────▶
       │                    │                    │
       │                    │ 3. GET /embed      │
       │                    │◀───────────────────│
       │                    │                    │
       │                    │ 4. Validate ticket │
       │                    │    Create session  │
       │                    │                    │
       │                    │ 5. Set cookie      │
       │                    │    Redirect /room  │
       │                    │───────────────────▶│
       │                    │                    │
       │                    │ 6. Load room.js    │
       │                    │    Connect SSE     │
       │                    │◀──────────────────▶│
```

### 2. Message Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   User A     │     │   Server     │     │   User B     │
│   Browser    │     │              │     │   Browser    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. POST /messages  │                    │
       │───────────────────▶│                    │
       │                    │                    │
       │                    │ 2. Sanitize        │
       │                    │    Save to S3      │
       │                    │                    │
       │ 3. Response        │                    │
       │◀───────────────────│                    │
       │                    │                    │
       │                    │ 4. SSE: new-message│
       │                    │───────────────────▶│
       │                    │                    │
       │ 4. SSE: new-message│                    │
       │◀───────────────────│                    │
```

### 3. WebRTC Signaling Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   User A     │     │   Server     │     │   User B     │
│              │     │   (SSE)      │     │              │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ 1. peer-join       │                    │
       │───────────────────▶│                    │
       │                    │ 2. broadcast       │
       │                    │───────────────────▶│
       │                    │                    │
       │                    │ 3. offer (to A)    │
       │◀───────────────────│◀───────────────────│
       │                    │                    │
       │ 4. answer (to B)   │                    │
       │───────────────────▶│───────────────────▶│
       │                    │                    │
       │ 5. ice-candidates  │                    │
       │◀──────────────────▶│◀──────────────────▶│
       │                    │                    │
       ├────────────────────┼────────────────────┤
       │      Direct P2P Connection             │
       │◀───────────────────────────────────────▶│
```

---

## Feature Details

### Chat Features
- **Text messages** with XSS sanitization
- **System messages** (join/leave notifications)
- **File messages** with attachment metadata
- **Message history** loaded on room entry
- **Real-time updates** via SSE

### Video/Audio Features
- **Peer-to-peer** WebRTC connections
- **Multi-party** mesh topology
- **Screen sharing** with track replacement
- **Audio/video mute** controls
- **Client-side recording** (MediaRecorder API)

### File Attachment Features
- **10MB size limit**
- **Allowed types**: JPEG, PNG, GIF, WebP, PDF, TXT, DOC, DOCX
- **Magic number verification** (file-type library)
- **Pre-signed S3 URLs** for secure downloads
- **Clipboard paste** support for images

### Session Management
- **24-hour session TTL**
- **Cookie-based** with header fallback
- **Multi-tab isolation** via `x-session-id` header
- **Automatic cleanup** of expired sessions

---

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `HOST` | Server host (default: 0.0.0.0) |
| `COOKIE_SECRET` | Secret for session cookies (min 32 chars) |
| `S3_BUCKET` | S3 bucket name |
| `S3_REGION` | S3 region (default: us-east-1) |
| `S3_ENDPOINT` | S3 endpoint URL |
| `S3_ACCESS_KEY` | S3 access key (optional for IAM roles) |
| `S3_SECRET_KEY` | S3 secret key (optional for IAM roles) |

### Hardcoded Configuration (src/constants/index.js)

| Constant | Description |
|----------|-------------|
| `ADMIN_PASSWORD` | Password for admin operations |
| `INTEGRATORS` | Array of integrator configurations |

### Integrator Configuration Example

Edit `src/constants/index.js`:

```javascript
export const INTEGRATORS = [
  {
    id: "acme-corp",
    secret: "super-secret-key-256-bits",
    allowedOrigins: ["https://acme.com", "https://app.acme.com"],
  },
];
```

---

## API Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/join` | None | Join page |
| GET | `/room/:id` | None | Room page |
| GET | `/admin` | None | Admin page |
| GET | `/embed` | Ticket | Iframe entry point |
| POST | `/api/v1/join` | Join code | Manual join |
| POST | `/api/v1/embed` | Ticket | API handshake |
| POST | `/api/v1/leave` | Session | Leave conversation |
| GET | `/api/v1/session` | Session | Get session info |
| GET | `/api/v1/conversation` | Session | Get conversation info |
| GET | `/api/v1/messages` | Session | Get message history |
| POST | `/api/v1/messages` | Session | Send message |
| GET | `/api/v1/signaling` | Session | SSE stream |
| POST | `/api/v1/signaling` | Session | Send signaling event |
| POST | `/api/v1/attachments` | Session | Upload file |
| GET | `/api/v1/attachments/:id` | Session | Get attachment |
| POST | `/api/v1/admin/conversations` | Admin | Create conversation |
| POST | `/api/v1/admin/conversations/:id` | Admin | Get conversation |
| POST | `/api/v1/admin/conversations/:id/close` | Admin | Close conversation |

---

## Development Commands

```bash
# Start development server (PM2 watch mode)
yarn dev

# Start production server
yarn start

# Stop server
yarn stop

# Run tests
yarn test

# Run linter
yarn lint

# Clean all PM2 processes
yarn clean
```
