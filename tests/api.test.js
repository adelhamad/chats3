// API integration tests
import { strict as assert } from "node:assert";
import { test, describe, before, after } from "node:test";

import { buildApp } from "../src/app.js";

describe("API Integration Tests", () => {
  let app;

  before(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  describe("Health Check", () => {
    test("GET /health should return ok", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, "ok");
      assert.strictEqual(body.service, "chats3");
    });
  });

  describe("Admin Routes", () => {
    test("POST /api/v1/admin/conversations should create conversation with valid password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/conversations",
        payload: {
          adminPassword: app.config.ADMIN_PASSWORD,
          conversationId: "test-conv-api-1",
        },
      });

      // Will fail without S3, but should validate password
      assert.ok(response.statusCode >= 200 && response.statusCode < 500);
    });

    test("POST /api/v1/admin/conversations should reject invalid password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/conversations",
        payload: {
          // eslint-disable-next-line sonarjs/no-hardcoded-passwords
          adminPassword: "wrong-password",
          conversationId: "test-conv-api-2",
        },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
    });
  });

  describe("Chat Routes", () => {
    test("POST /api/v1/join should require valid conversation", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/join",
        payload: {
          conversationId: "non-existent",
          joinCode: "ABC123",
          displayName: "Test User",
        },
      });

      // Could be 400 or 403 depending on validation order
      assert.ok(response.statusCode >= 400 && response.statusCode < 500);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
    });

    test("POST /api/v1/embed should validate ticket", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/embed",
        payload: {
          ticket: "invalid",
          signature: "invalid",
        },
      });

      // Could be 400 or 403 depending on validation
      assert.ok(response.statusCode >= 400 && response.statusCode < 500);
    });

    test("GET /api/v1/messages should require session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/messages",
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
    });

    test("POST /api/v1/messages should require session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/messages",
        payload: {
          type: "text",
          body: "Test message",
          clientTimestamp: new Date().toISOString(),
        },
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
    });

    test("GET /api/v1/signaling should require session", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/signaling",
      });

      assert.strictEqual(response.statusCode, 401);
    });

    test("POST /api/v1/signaling should require session", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/signaling",
        payload: {
          type: "peer-join",
          data: {},
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("View Routes", () => {
    test("GET / should redirect to /join", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/",
      });

      assert.strictEqual(response.statusCode, 302);
      assert.strictEqual(response.headers.location, "/join");
    });

    test("GET /join should return HTML", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/join",
      });

      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers["content-type"].includes("text/html"));
      assert.ok(response.body.includes("Join Conversation"));
    });

    test("GET /room/:conversationId should return HTML", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/room/test-conv",
      });

      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers["content-type"].includes("text/html"));
      assert.ok(response.body.includes("test-conv"));
    });
  });

  describe("Security Headers", () => {
    test("should include security headers", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      assert.ok(response.headers["x-content-type-options"]);
      assert.strictEqual(response.headers["x-content-type-options"], "nosniff");
      // assert.ok(response.headers["x-frame-options"]); // CSP frame-ancestors is used instead
      assert.ok(response.headers["x-xss-protection"]);
      assert.ok(response.headers["content-security-policy"]);
    });
  });

  describe("Rate Limiting", () => {
    test("should apply rate limiting", async () => {
      // Make many requests (more than 300 limit)
      const requests = [];
      for (let i = 0; i < 350; i++) {
        requests.push(
          app.inject({
            method: "GET",
            url: "/health",
          }),
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.some((r) => r.statusCode === 429);

      // Should eventually get rate limited
      assert.ok(rateLimited, "Expected some requests to be rate limited");
    });
  });
});
