// Authentication module tests
import crypto from "crypto";
import { strict as assert } from "node:assert";
import { test, describe, beforeEach } from "node:test";

import {
  checkAndStoreNonce,
  clearNonceStore,
  parseIntegrators,
  validateTicket,
  isOriginAllowed,
} from "../src/modules/auth/index.js";

describe("Authentication Module", () => {
  describe("Nonce Store", () => {
    beforeEach(() => {
      clearNonceStore();
    });

    test("checkAndStoreNonce should accept new nonce", () => {
      const nonce = crypto.randomUUID();
      const result = checkAndStoreNonce(nonce);
      assert.strictEqual(result, true);
    });

    test("checkAndStoreNonce should reject duplicate nonce", () => {
      const nonce = crypto.randomUUID();
      checkAndStoreNonce(nonce);
      const result = checkAndStoreNonce(nonce);
      assert.strictEqual(result, false);
    });
  });

  describe("Integrator Parsing", () => {
    test("parseIntegrators should parse valid JSON", () => {
      const json = JSON.stringify([
        {
          id: "test-integrator",
          secret: "test-secret",
          allowedOrigins: ["https://example.com"],
        },
      ]);

      const integrators = parseIntegrators(json);

      assert.strictEqual(integrators.size, 1);
      assert.ok(integrators.has("test-integrator"));
      const integrator = integrators.get("test-integrator");
      assert.strictEqual(integrator.secret, "test-secret");
      assert.deepStrictEqual(integrator.allowedOrigins, [
        "https://example.com",
      ]);
    });

    test("parseIntegrators should handle empty array", () => {
      const integrators = parseIntegrators("[]");
      assert.strictEqual(integrators.size, 0);
    });

    test("parseIntegrators should handle invalid JSON", () => {
      const integrators = parseIntegrators("invalid json");
      assert.strictEqual(integrators.size, 0);
    });
  });

  describe("Ticket Validation", () => {
    const integratorId = "test-integrator";
    const integratorSecret = "test-secret-key";
    const allowedOrigin = "http://localhost:3000";

    const integrators = parseIntegrators(
      JSON.stringify([
        {
          id: integratorId,
          secret: integratorSecret,
          allowedOrigins: [allowedOrigin],
        },
      ]),
    );

    beforeEach(() => {
      clearNonceStore();
    });

    test("validateTicket should accept valid ticket", () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30000); // 30 seconds

      const ticketData = {
        integratorId,
        conversationId: "conv-123",
        userId: "user-123",
        displayName: "Test User",
        avatarUrl: "https://example.com/avatar.jpg",
        role: "user",
        origin: allowedOrigin,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        nonce: crypto.randomUUID(),
      };

      const ticket = JSON.stringify(ticketData);
      const signature = crypto
        .createHmac("sha256", integratorSecret)
        .update(ticket)
        .digest("base64url");

      const result = validateTicket(ticket, signature, integrators);

      assert.strictEqual(result.valid, true);
      assert.ok(result.data);
      assert.strictEqual(result.data.userId, "user-123");
      assert.strictEqual(result.data.displayName, "Test User");
    });

    test("validateTicket should reject invalid signature", () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30000);

      const ticketData = {
        integratorId,
        conversationId: "conv-123",
        userId: "user-123",
        displayName: "Test User",
        role: "user",
        origin: allowedOrigin,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        nonce: crypto.randomUUID(),
      };

      const ticket = JSON.stringify(ticketData);
      const signature = "invalid-signature";

      const result = validateTicket(ticket, signature, integrators);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Invalid signature");
    });

    test("validateTicket should reject expired ticket", () => {
      const past = new Date(Date.now() - 120000); // 2 minutes ago
      const expired = new Date(Date.now() - 60000); // 1 minute ago

      const ticketData = {
        integratorId,
        conversationId: "conv-123",
        userId: "user-123",
        displayName: "Test User",
        role: "user",
        origin: allowedOrigin,
        issuedAt: past.toISOString(),
        expiresAt: expired.toISOString(),
        nonce: crypto.randomUUID(),
      };

      const ticket = JSON.stringify(ticketData);
      const signature = crypto
        .createHmac("sha256", integratorSecret)
        .update(ticket)
        .digest("base64url");

      const result = validateTicket(ticket, signature, integrators);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Ticket expired");
    });

    test("validateTicket should reject ticket with wrong origin", () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30000);

      const ticketData = {
        integratorId,
        conversationId: "conv-123",
        userId: "user-123",
        displayName: "Test User",
        role: "user",
        origin: "https://evil.com",
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        nonce: crypto.randomUUID(),
      };

      const ticket = JSON.stringify(ticketData);
      const signature = crypto
        .createHmac("sha256", integratorSecret)
        .update(ticket)
        .digest("base64url");

      const result = validateTicket(ticket, signature, integrators);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, "Origin not allowed");
    });

    test("validateTicket should reject reused nonce", () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30000);
      const nonce = crypto.randomUUID();

      const ticketData = {
        integratorId,
        conversationId: "conv-123",
        userId: "user-123",
        displayName: "Test User",
        role: "user",
        origin: allowedOrigin,
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        nonce,
      };

      const ticket = JSON.stringify(ticketData);
      const signature = crypto
        .createHmac("sha256", integratorSecret)
        .update(ticket)
        .digest("base64url");

      // First attempt should succeed
      const result1 = validateTicket(ticket, signature, integrators);
      assert.strictEqual(result1.valid, true);

      // Second attempt with same nonce should fail
      const result2 = validateTicket(ticket, signature, integrators);
      assert.strictEqual(result2.valid, false);
      assert.ok(result2.error.includes("replay attack"));
    });
  });

  describe("Origin Matching", () => {
    test("isOriginAllowed should match exact origin", () => {
      const origins = ["https://example.com", "https://other.com"];
      assert.strictEqual(isOriginAllowed("https://example.com", origins), true);
      assert.strictEqual(isOriginAllowed("https://other.com", origins), true);
      assert.strictEqual(isOriginAllowed("https://unknown.com", origins), false);
    });

    test("isOriginAllowed should match exact origin with port", () => {
      const origins = ["http://localhost:3000", "http://localhost:4000"];
      assert.strictEqual(isOriginAllowed("http://localhost:3000", origins), true);
      assert.strictEqual(isOriginAllowed("http://localhost:4000", origins), true);
      assert.strictEqual(isOriginAllowed("http://localhost:5000", origins), false);
    });

    test("isOriginAllowed should match wildcard subdomain", () => {
      const origins = ["https://*.vercel.app"];
      assert.strictEqual(isOriginAllowed("https://myapp.vercel.app", origins), true);
      assert.strictEqual(isOriginAllowed("https://preview-123.vercel.app", origins), true);
      assert.strictEqual(isOriginAllowed("https://vercel.app", origins), true);
      assert.strictEqual(isOriginAllowed("http://myapp.vercel.app", origins), false); // wrong protocol
      assert.strictEqual(isOriginAllowed("https://vercel.com", origins), false);
    });

    test("isOriginAllowed should match nested wildcard subdomain", () => {
      const origins = ["https://*.example.com"];
      assert.strictEqual(isOriginAllowed("https://app.example.com", origins), true);
      assert.strictEqual(isOriginAllowed("https://sub.app.example.com", origins), true);
    });

    test("isOriginAllowed should reject invalid origins", () => {
      const origins = ["https://example.com"];
      assert.strictEqual(isOriginAllowed("not-a-url", origins), false);
      assert.strictEqual(isOriginAllowed("", origins), false);
    });
  });
});
