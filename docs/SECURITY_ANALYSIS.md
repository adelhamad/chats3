# Chats3 Service - Security Analysis

## Executive Summary

Chats3 implements **solid security fundamentals** for a chat microservice, including HMAC-signed authentication tickets, XSS protection, rate limiting, and proper security headers. However, there are areas that could be strengthened, particularly around session management and input validation.

**Overall Security Rating: B+**

---

## Security Features Implemented

### ✅ Authentication & Authorization

#### 1. HMAC-Signed Tickets (Iframe Embedding)

**Location:** `src/modules/auth/handshake.js`

The iframe embedding uses a cryptographically secure handshake:

```javascript
// Server-side validation
const expectedSignature = crypto
  .createHmac("sha256", integrator.secret)
  .update(ticket)
  .digest("base64url");

if (signature !== expectedSignature) {
  return { valid: false, error: "Invalid signature" };
}
```

**Strengths:**
- Uses SHA-256 HMAC for signature verification
- Ticket contains all necessary claims (userId, role, conversationId, etc.)
- Integrator secrets are per-integration, limiting blast radius

**Ticket Structure:**
```json
{
  "integratorId": "acme-corp",
  "conversationId": "conv-123",
  "userId": "user-456",
  "displayName": "John Doe",
  "avatarUrl": "https://...",
  "role": "user",
  "origin": "https://acme.com",
  "issuedAt": "2025-12-28T10:00:00Z",
  "expiresAt": "2025-12-28T10:01:00Z",
  "nonce": "abc123"
}
```

#### 2. Replay Attack Protection

**Location:** `src/modules/auth/nonce-store.js`

```javascript
export function checkAndStoreNonce(nonce) {
  if (nonceStore.has(nonce)) {
    return false; // Replay attack detected
  }
  nonceStore.set(nonce, Date.now());
  return true;
}
```

**Strengths:**
- Each nonce can only be used once
- 2-minute TTL prevents memory bloat
- Automatic cleanup via setInterval

#### 3. Ticket Expiry Validation

```javascript
// Check expiry
const expiresAtMs = new Date(expiresAt).getTime();
if (now > expiresAtMs) {
  return { valid: false, error: "Ticket expired" };
}

// Check ticket age (must be <= 60 seconds)
const issuedAtMs = new Date(issuedAt).getTime();
if (now - issuedAtMs > 60000) {
  return { valid: false, error: "Ticket too old" };
}
```

**Strengths:**
- Tickets expire in 60 seconds maximum
- Prevents use of old tickets even if not yet expired

#### 4. Origin Validation

```javascript
if (!integrator.allowedOrigins.includes(origin)) {
  return { valid: false, error: "Origin not allowed" };
}
```

**Strengths:**
- Validates ticket origin against whitelist
- Prevents ticket use from unauthorized domains

---

### ✅ Session Management

**Location:** `src/modules/session/session-store.js`

```javascript
export function createSession(sessionData) {
  const sessionId = crypto.randomUUID();
  // ...
  sessions.set(sessionId, session);
  return session;
}
```

**Strengths:**
- UUIDv4 session IDs (cryptographically random)
- 24-hour session TTL with automatic cleanup
- HttpOnly cookies prevent JavaScript access
- Secure + SameSite=None in production for cross-origin iframes

**Cookie Configuration:**
```javascript
const cookieOptions = {
  httpOnly: true,
  path: "/",
  maxAge: 24 * 60 * 60, // 24 hours
};

if (fastify.config.NODE_ENV === "production") {
  cookieOptions.secure = true;
  cookieOptions.sameSite = "none";
}
```

---

### ✅ Input Validation

**Location:** `src/modules/chat/routes.js`

All inputs are validated using Zod schemas:

```javascript
const joinSchema = z.object({
  conversationId: z.string(),
  joinCode: z.string(),
  displayName: z.string().min(1).max(100),
  avatarUrl: z.string().url().optional(),
});

const messageSchema = z.object({
  messageId: z.string().uuid().optional(),
  type: z.enum(["text", "system", "file"]).default("text"),
  body: z.string(),
  clientTimestamp: z.string().datetime(),
  // ...
});
```

**Strengths:**
- Type validation on all inputs
- Enum constraints for message types
- UUID validation for message IDs
- URL validation for avatar URLs

---

### ✅ XSS Prevention

**Location:** `src/modules/message/message-service.js`

```javascript
import sanitizeHtml from "sanitize-html";

export function sanitizeMessageBody(body) {
  if (!body || typeof body !== "string") {
    return "";
  }

  return sanitizeHtml(body, {
    allowedTags: [],        // No HTML tags allowed
    allowedAttributes: {},  // No attributes allowed
  });
}
```

**Strengths:**
- Complete HTML stripping using sanitize-html
- Applied before storage and broadcast
- Null/undefined safety check

---

### ✅ Security Headers

**Location:** `src/app.js`

```javascript
app.addHook("onSend", async (request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-XSS-Protection", "1; mode=block");

  reply.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors ${frameAncestors};`
  );

  if (app.config.NODE_ENV === "production") {
    reply.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
});
```

**Headers Applied:**
| Header | Value | Purpose |
|--------|-------|---------|
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-XSS-Protection | 1; mode=block | Browser XSS filter |
| Content-Security-Policy | Restrictive policy | Content restrictions |
| Strict-Transport-Security | 1 year | Force HTTPS (production) |

**Dynamic frame-ancestors:**
```javascript
const integrators = parseIntegrators(app.config.INTEGRATORS_JSON);
const allowedOrigins = Array.from(integrators.values())
  .flatMap((i) => i.allowedOrigins)
  .join(" ");

const frameAncestors = allowedOrigins ? `'self' ${allowedOrigins}` : "'self'";
```

---

### ✅ Rate Limiting

**Location:** `src/app.js` and `src/modules/admin/routes.js`

```javascript
// Global rate limit
await app.register(fastifyRateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// Admin-specific rate limit
fastify.post("/admin/conversations", {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute",
    },
  },
}, handler);
```

**Rate Limits:**
| Scope | Limit | Window |
|-------|-------|--------|
| Global | 100 requests | 1 minute |
| Admin routes | 10 requests | 1 minute |

---

### ✅ File Upload Security

**Location:** `src/modules/attachment/attachment-service.js`

```javascript
const ALLOWED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Validate mime type
if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
  throw new Error("File type not allowed");
}

// Verify magic numbers (actual file content)
const type = await fileTypeFromBuffer(buffer);
if (!type || !ALLOWED_MIME_TYPES.includes(type.mime)) {
  throw new Error("Invalid file content (magic number mismatch)");
}

// Validate size
if (sizeBytes > MAX_FILE_SIZE) {
  throw new Error("File too large");
}
```

**Strengths:**
- Whitelist of allowed MIME types
- Magic number verification (prevents extension spoofing)
- Size limit enforcement
- Special handling for text/plain (no magic bytes)

---

### ✅ S3 Security

**Location:** `src/modules/storage/s3-service.js`

```javascript
// Pre-signed URLs with expiry
export async function getAttachmentSignedUrl(conversationId, attachmentId, expiresIn = 900) {
  const key = `conversations/${conversationId}/attachments/${attachmentId}/original`;
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn }); // 15 minutes
}
```

**Strengths:**
- Pre-signed URLs prevent direct S3 access
- 15-minute expiry on download URLs
- Conversation-scoped paths prevent cross-conversation access
- Metadata sanitization for non-ASCII filenames

---

## ⚠️ Security Concerns & Recommendations

### 1. Session ID in URL Query String

**Severity:** Medium  
**Location:** `src/modules/ui/routes.js:49-52`

```javascript
// Current implementation
return reply.redirect(`/room/${conversationId}?sessionId=${session.sessionId}`);
```

**Risk:** Session ID exposed in:
- Browser history
- Server logs
- Referer headers to third-party resources
- Shoulder surfing

**Recommendation:**
Use a short-lived exchange token:

```javascript
// Generate short-lived token
const exchangeToken = crypto.randomUUID();
exchangeTokenStore.set(exchangeToken, {
  sessionId: session.sessionId,
  createdAt: Date.now(),
  ttl: 30000 // 30 seconds
});

// Redirect with exchange token
return reply.redirect(`/room/${conversationId}?token=${exchangeToken}`);

// In room.js, exchange token for session
const response = await fetch(`/api/v1/exchange?token=${token}`);
// Server sets sessionId cookie and clears token from store
```

---

### 2. No CSRF Protection

**Severity:** Medium  
**Location:** All POST routes

**Risk:** While `SameSite=None` with `Secure` provides some protection, explicit CSRF tokens add defense in depth.

**Current Mitigation:** 
- Cookies are HttpOnly
- SameSite attribute (Lax in dev, None+Secure in prod)
- Origin validation on tickets

**Recommendation:**
Add CSRF tokens for state-changing operations:

```javascript
import fastifyCsrf from "@fastify/csrf-protection";

await app.register(fastifyCsrf, {
  cookieOpts: { signed: true }
});

// In routes that need CSRF protection
fastify.post("/messages", {
  preHandler: [requireSession, fastify.csrfProtection]
}, handler);
```

---

### 3. No Message Body Length Limit

**Severity:** Medium  
**Location:** `src/modules/chat/routes.js` - messageSchema

```javascript
// Current - no max length
const messageSchema = z.object({
  body: z.string(),
  // ...
});
```

**Risk:** Users could send extremely large messages causing:
- Memory pressure
- Storage costs
- UI performance issues

**Recommendation:**
```javascript
const messageSchema = z.object({
  body: z.string().max(10000), // 10KB limit
  // ...
});
```

---

### 4. No Participant Limit Per Conversation

**Severity:** Low-Medium  
**Location:** `src/modules/chat/routes.js` - join handler

**Risk:** Unbounded session creation could lead to:
- Memory exhaustion
- WebRTC mesh overload (n² connections)
- Denial of service

**Recommendation:**
```javascript
const MAX_PARTICIPANTS = 50;

const existingSessions = getSessionsByConversation(conversationId);
if (existingSessions.length >= MAX_PARTICIPANTS) {
  reply.status(403);
  return fail.parse({ message: "Conversation is full" });
}
```

---

### 5. CSP Uses `unsafe-inline`

**Severity:** Low  
**Location:** `src/app.js:77`

```javascript
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
```

**Risk:** Weakens CSP protection against XSS via inline scripts.

**Recommendation:**
Use nonces for inline scripts:

```javascript
const nonce = crypto.randomBytes(16).toString("base64");
reply.header(
  "Content-Security-Policy",
  `script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline';`
);
// Pass nonce to templates
```

---

### 6. EventEmitter Unbounded Listeners

**Severity:** Low  
**Location:** `src/modules/signaling/signaling-store.js`

```javascript
signalingEmitter.on(`event-${conversationId}`, onEvent);
```

**Risk:** Many SSE connections could cause EventEmitter warnings or memory issues.

**Recommendation:**
```javascript
// Set max listeners per conversation
signalingEmitter.setMaxListeners(100);

// Or track and limit per conversation
const listenerCounts = new Map();
if ((listenerCounts.get(conversationId) || 0) >= 50) {
  throw new Error("Too many active connections");
}
```

---

### 7. Admin Password in Request Body

**Severity:** Low (noted as ignored but worth documenting)  
**Location:** `src/modules/admin/routes.js`

**Risk:** Password transmitted on every admin request, though mitigated by HTTPS requirement.

**Better Alternative:** JWT-based admin authentication with token refresh.

---

## Security Checklist

| Category | Item | Status |
|----------|------|--------|
| **Authentication** | Cryptographic signatures | ✅ |
| | Replay protection | ✅ |
| | Token expiry | ✅ |
| | Origin validation | ✅ |
| **Session** | Random session IDs | ✅ |
| | Session expiry | ✅ |
| | HttpOnly cookies | ✅ |
| | Secure cookies (prod) | ✅ |
| | Session ID exposure | ⚠️ |
| **Input** | Schema validation | ✅ |
| | Type constraints | ✅ |
| | Length limits | ⚠️ Partial |
| **Output** | XSS sanitization | ✅ |
| | Content-Type headers | ✅ |
| **Transport** | HTTPS enforcement | ✅ |
| | HSTS | ✅ (prod) |
| **Headers** | X-Content-Type-Options | ✅ |
| | X-XSS-Protection | ✅ |
| | CSP | ⚠️ unsafe-inline |
| | CSRF protection | ⚠️ Implicit only |
| **Rate Limiting** | Global limits | ✅ |
| | Admin limits | ✅ |
| | Per-route limits | ⚠️ Could expand |
| **Files** | Type whitelist | ✅ |
| | Magic number check | ✅ |
| | Size limits | ✅ |
| | Signed URLs | ✅ |

---

## Attack Vectors & Mitigations

### 1. XSS Attack
**Vector:** Malicious script in message body  
**Mitigation:** ✅ sanitize-html strips all HTML

### 2. CSRF Attack
**Vector:** Forged requests from malicious site  
**Mitigation:** ⚠️ SameSite cookies (partial)

### 3. Replay Attack
**Vector:** Reusing intercepted tickets  
**Mitigation:** ✅ Nonce store + ticket expiry

### 4. Session Hijacking
**Vector:** Stealing session ID  
**Mitigation:** ✅ HttpOnly + Secure cookies; ⚠️ URL exposure

### 5. File Upload Attack
**Vector:** Malicious file upload  
**Mitigation:** ✅ Whitelist + magic number verification

### 6. DoS Attack
**Vector:** Flood of requests  
**Mitigation:** ✅ Rate limiting (100/min)

### 7. Man-in-the-Middle
**Vector:** Intercepting unencrypted traffic  
**Mitigation:** ✅ HTTPS + HSTS in production

### 8. Clickjacking
**Vector:** Embedding in malicious frame  
**Mitigation:** ✅ frame-ancestors CSP directive

---

## Recommendations Summary

### High Priority
1. **Add message body length limits** - Prevents memory/storage abuse
2. **Add participant limits** - Prevents DoS via session flooding
3. **Use exchange tokens instead of session ID in URL** - Reduces session exposure

### Medium Priority
4. **Add explicit CSRF tokens** - Defense in depth
5. **Add CSP nonces** - Removes unsafe-inline requirement
6. **Add EventEmitter limits** - Prevents memory issues

### Low Priority
7. **Document security architecture** - Helps integrators
8. **Add security audit logging** - Failed auth attempts, etc.
9. **Consider rate limiting by session** - Prevent abuse from authenticated users
