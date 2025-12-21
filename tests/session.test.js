// Session module tests
import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import {
  createSession,
  getSession,
  deleteSession,
  getSessionsByConversation,
  clearAllSessions,
} from "../src/modules/session/index.js";

describe("Session Module", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  test("createSession should create a new session", () => {
    const sessionData = {
      userId: "user-123",
      displayName: "Test User",
      avatarUrl: "https://example.com/avatar.jpg",
      role: "user",
      conversationId: "conv-123",
    };

    const session = createSession(sessionData);

    assert.ok(session.sessionId);
    assert.strictEqual(session.userId, sessionData.userId);
    assert.strictEqual(session.displayName, sessionData.displayName);
    assert.strictEqual(session.avatarUrl, sessionData.avatarUrl);
    assert.strictEqual(session.role, sessionData.role);
    assert.strictEqual(session.conversationId, sessionData.conversationId);
    assert.ok(session.createdAt);
  });

  test("createSession should default role to user", () => {
    const sessionData = {
      userId: "user-123",
      displayName: "Test User",
      conversationId: "conv-123",
    };

    const session = createSession(sessionData);

    assert.strictEqual(session.role, "user");
    assert.strictEqual(session.avatarUrl, null);
  });

  test("getSession should retrieve existing session", () => {
    const sessionData = {
      userId: "user-123",
      displayName: "Test User",
      conversationId: "conv-123",
    };

    const created = createSession(sessionData);
    const retrieved = getSession(created.sessionId);

    assert.deepStrictEqual(retrieved, created);
  });

  test("getSession should return undefined for non-existent session", () => {
    const session = getSession("non-existent-id");
    assert.strictEqual(session, undefined);
  });

  test("deleteSession should remove session", () => {
    const sessionData = {
      userId: "user-123",
      displayName: "Test User",
      conversationId: "conv-123",
    };

    const session = createSession(sessionData);
    assert.ok(getSession(session.sessionId));

    deleteSession(session.sessionId);
    assert.strictEqual(getSession(session.sessionId), undefined);
  });

  test("getSessionsByConversation should return sessions for conversation", () => {
    const conv1 = "conv-1";
    const conv2 = "conv-2";

    createSession({
      userId: "user-1",
      displayName: "User 1",
      conversationId: conv1,
    });
    createSession({
      userId: "user-2",
      displayName: "User 2",
      conversationId: conv1,
    });
    createSession({
      userId: "user-3",
      displayName: "User 3",
      conversationId: conv2,
    });

    const conv1Sessions = getSessionsByConversation(conv1);
    const conv2Sessions = getSessionsByConversation(conv2);

    assert.strictEqual(conv1Sessions.length, 2);
    assert.strictEqual(conv2Sessions.length, 1);
  });

  test("clearAllSessions should remove all sessions", () => {
    createSession({
      userId: "user-1",
      displayName: "User 1",
      conversationId: "conv-1",
    });
    createSession({
      userId: "user-2",
      displayName: "User 2",
      conversationId: "conv-2",
    });

    clearAllSessions();

    const allSessions = getSessionsByConversation("conv-1");
    assert.strictEqual(allSessions.length, 0);
  });
});
