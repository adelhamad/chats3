// Signaling module tests
import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import {
  addSignalingEvent,
  pollSignalingEvents,
  clearConversationSignaling,
} from "../src/modules/signaling/index.js";

describe("Signaling Module", () => {
  const conversationId = "test-conv";
  const userId1 = "user-1";
  const userId2 = "user-2";

  beforeEach(() => {
    clearConversationSignaling(conversationId);
  });

  test("addSignalingEvent should add event", () => {
    const event = addSignalingEvent(conversationId, {
      type: "peer-join",
      fromUserId: userId1,
      data: { displayName: "User 1" },
    });

    assert.ok(event.id);
    assert.strictEqual(event.type, "peer-join");
    assert.strictEqual(event.fromUserId, userId1);
    assert.ok(event.timestamp);
  });

  test("pollSignalingEvents should return all events on first poll", () => {
    addSignalingEvent(conversationId, {
      type: "peer-join",
      fromUserId: userId1,
      data: {},
    });
    addSignalingEvent(conversationId, {
      type: "offer",
      fromUserId: userId1,
      toUserId: userId2,
      data: { sdp: "offer-sdp" },
    });

    const result = pollSignalingEvents(conversationId, userId2);

    assert.strictEqual(result.events.length, 2);
    assert.ok(result.cursor);
  });

  test("pollSignalingEvents should filter by toUserId", () => {
    addSignalingEvent(conversationId, {
      type: "offer",
      fromUserId: userId1,
      toUserId: userId2,
      data: { sdp: "offer-sdp" },
    });
    addSignalingEvent(conversationId, {
      type: "answer",
      fromUserId: userId2,
      toUserId: "user-3",
      data: { sdp: "answer-sdp" },
    });

    const result = pollSignalingEvents(conversationId, userId2);

    // user-2 should only see events targeted to them or from them or broadcast
    assert.strictEqual(result.events.length, 2);
  });

  test("pollSignalingEvents should use cursor for incremental updates", () => {
    const result1 = pollSignalingEvents(conversationId, userId1);
    assert.strictEqual(result1.events.length, 0);

    addSignalingEvent(conversationId, {
      type: "peer-join",
      fromUserId: userId2,
      data: {},
    });

    const result2 = pollSignalingEvents(conversationId, userId1, result1.cursor);
    assert.strictEqual(result2.events.length, 1);
    assert.strictEqual(result2.events[0].type, "peer-join");
  });

  test("clearConversationSignaling should remove all events", () => {
    addSignalingEvent(conversationId, {
      type: "peer-join",
      fromUserId: userId1,
      data: {},
    });

    clearConversationSignaling(conversationId);

    const result = pollSignalingEvents(conversationId, userId1);
    assert.strictEqual(result.events.length, 0);
  });
});
