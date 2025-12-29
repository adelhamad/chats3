# Chats3 Service - Enhancement Recommendations

This document outlines enhancements for the Chats3 service, organized by priority and category.

---

## ✅ Implemented Enhancements

### 1. Input Validation Hardening ✅

**Status:** IMPLEMENTED

All Zod schemas now include maximum length constraints:
- Message body: max 10KB
- Display name: 1-50 chars
- Conversation ID: max 100 chars, alphanumeric pattern
- Join code: exactly 6 chars, A-Z0-9 pattern
- URLs: max 2048 chars

---

### 2. Conversation Participant Limits ✅

**Status:** IMPLEMENTED

- Max 50 participants per conversation
- Defined in `src/constants/index.js` as `MAX_PARTICIPANTS`

---

### 3. Graceful Shutdown Handler ✅

**Status:** IMPLEMENTED

- Handles SIGTERM and SIGINT signals
- Properly closes Fastify server before exit

---

### 4. S3 Retry Logic ✅

**Status:** IMPLEMENTED

- Exponential backoff with 3 retries
- Handles transient S3 failures gracefully

---

### 5. Typing Indicators ✅

**Status:** IMPLEMENTED

- Real-time typing indicators via WebRTC data channels
- Shows participant names (e.g., "John is typing...", "John and Mary are typing...")

---

### 6. Message Reactions ✅

**Status:** IMPLEMENTED

- Configurable emoji reactions in `src/modules/ui/public/js/room/state.js`
- One reaction per user per message
- Real-time sync via WebRTC

---

### 7. Online Status by Display Name ✅

**Status:** IMPLEMENTED

- Tracks userId-to-displayName mapping
- Same person rejoining shows as online for their old messages

---

### 8. Configuration Simplification ✅

**Status:** IMPLEMENTED

- `ADMIN_PASSWORD` and `INTEGRATORS` moved to `src/constants/index.js`
- Reduces environment variable complexity

---

## Medium Priority Enhancements (Not Yet Implemented)

### 1. API Documentation (OpenAPI/Swagger)

**Problem:** No API documentation for integrators.

**Implementation:** Add `@fastify/swagger` and `@fastify/swagger-ui` with schema definitions on routes.

---

### 2. Message Pagination

**Problem:** Current implementation returns only last 100 messages with no pagination.

**Implementation:** Add cursor-based pagination with `cursor`, `limit`, and `direction` query params.

---

### 3. Presence Status API

**Problem:** No explicit presence/away status (only implicit via SSE connection).

**Implementation:** Add `/presence` endpoint with status updates (online/away/offline).

---

## Low Priority Enhancements (Not Yet Implemented)

### 1. WebSocket Support

**Rationale:** SSE is unidirectional; WebSocket provides lower latency bidirectional communication.

**Implementation:** Add `@fastify/websocket` for optional WebSocket signaling.

---

### 2. Message Editing & Deletion

**Implementation:** Add PATCH/DELETE `/messages/:messageId` with ownership verification and time limits.

---

### 3. Image Thumbnails

**Implementation:** Use `sharp` to generate thumbnails for uploaded images.

---

## Enhancement Priority Matrix

| Enhancement | Effort | Impact | Priority | Status |
|-------------|--------|--------|----------|--------|
| Input validation hardening | Low | High | **P1** | ✅ Implemented |
| Participant limits | Low | High | **P1** | ✅ Implemented |
| Graceful shutdown | Low | Medium | **P1** | ✅ Implemented |
| API documentation | Medium | High | **P1** | ⏭️ Skipped |
| Typing indicators | Low | Medium | **P2** | ✅ Implemented (WebRTC) |
| Read receipts | Medium | Medium | **P2** | ✅ Already existed |
| Message pagination | Medium | High | **P2** | ⏭️ Skipped |
| Presence status | Medium | Medium | **P2** | ⏭️ Skipped |
| S3 retry logic | Low | Medium | **P2** | ✅ Implemented |
| WebSocket support | High | Medium | **P3** | ⏭️ Skipped |
| Message editing/deletion | Medium | Medium | **P3** | ⏭️ Skipped |
| Message reactions | Medium | Low | **P3** | ✅ Implemented (WebRTC) |
| Image thumbnails | Medium | Low | **P3** | ⏭️ Skipped |

---

## Implementation Summary

### ✅ Implemented Features

1. **Input Validation Hardening** - Added max lengths and regex patterns to all schemas
2. **Participant Limits** - Max 50 participants per conversation (configurable in `src/constants/index.js`)
3. **Graceful Shutdown** - SIGTERM/SIGINT handlers for clean SSE disconnection
4. **Typing Indicators** - Via WebRTC data channel (zero server overhead)
5. **Read Receipts** - Via WebRTC data channel (already existed)
6. **S3 Retry Logic** - Exponential backoff for transient failures
7. **Message Reactions** - Configurable emoji reactions via WebRTC (edit `REACTIONS` in `src/modules/ui/public/js/room/state.js`)

### ⏭️ Skipped Features

- **API Documentation (OpenAPI)** - Can be added later if needed
- **Message Pagination** - Current limit of 100 messages sufficient for most use cases
- **Presence Status** - Online count already shown in UI
- **WebSocket Support** - SSE works well for current needs
- **Message Editing/Deletion** - Adds complexity, not critical for MVP
- **Image Thumbnails** - Browser handles image scaling adequately

---

## Implementation Roadmap

### Phase 1 (Week 1-2) - Foundation ✅ COMPLETE
- [x] Add input validation limits
- [x] Implement participant limits
- [x] Add graceful shutdown
- [ ] ~~Set up OpenAPI documentation~~ (Skipped)

### Phase 2 (Week 3-4) - User Experience ✅ COMPLETE
- [x] Implement typing indicators
- [ ] ~~Add message pagination~~ (Skipped)
- [ ] ~~Add presence status~~ (Skipped)

### Phase 3 (Week 5-6) - Robustness ✅ COMPLETE
- [x] Add S3 retry logic
- [x] Read receipts (already existed)
- [x] Message reactions

### Phase 4 (Optional) - Advanced Features
- [ ] ~~Consider WebSocket support~~ (Skipped)
- [ ] ~~Add message editing/deletion~~ (Skipped)
- [ ] ~~Generate image thumbnails~~ (Skipped)
