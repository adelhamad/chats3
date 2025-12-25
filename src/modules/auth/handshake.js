// iframe handshake ticket validation
import crypto from "crypto";

import { checkAndStoreNonce } from "./nonce-store.js";

export function parseIntegrators(integratorsJson) {
  try {
    const integrators = JSON.parse(integratorsJson);
    const integratorMap = new Map();
    for (const integrator of integrators) {
      integratorMap.set(integrator.id, {
        id: integrator.id,
        secret: integrator.secret,
        allowedOrigins: integrator.allowedOrigins || [],
      });
    }
    return integratorMap;
  } catch {
    return new Map();
  }
}

export function validateTicket(ticket, signature, integrators) {
  try {
    // Parse ticket
    const ticketData = JSON.parse(ticket);

    const {
      integratorId,
      conversationId,
      userId,
      displayName,
      avatarUrl,
      role,
      origin,
      issuedAt,
      expiresAt,
      nonce,
    } = ticketData;

    // Check required fields
    if (
      !integratorId ||
      !conversationId ||
      !userId ||
      !displayName ||
      !role ||
      !origin ||
      !issuedAt ||
      !expiresAt ||
      !nonce
    ) {
      return { valid: false, error: "Missing required fields" };
    }

    // Check if integrator exists
    const integrator = integrators.get(integratorId);
    if (!integrator) {
      return { valid: false, error: "Unknown integrator" };
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", integrator.secret)
      .update(ticket)
      .digest("base64url");

    if (signature !== expectedSignature) {
      return { valid: false, error: "Invalid signature" };
    }

    // Check expiry
    const now = Date.now();
    const expiresAtMs = new Date(expiresAt).getTime();
    if (now > expiresAtMs) {
      return { valid: false, error: "Ticket expired" };
    }

    // Check ticket age (must be <= 60 seconds)
    const issuedAtMs = new Date(issuedAt).getTime();
    if (now - issuedAtMs > 60000) {
      return { valid: false, error: "Ticket too old" };
    }

    // Check origin
    if (!integrator.allowedOrigins.includes(origin)) {
      return { valid: false, error: "Origin not allowed" };
    }

    // Check nonce (replay protection)
    if (!checkAndStoreNonce(nonce)) {
      return { valid: false, error: "Nonce already used (replay attack)" };
    }

    // All checks passed
    return {
      valid: true,
      data: {
        integratorId,
        conversationId,
        userId,
        displayName,
        avatarUrl: avatarUrl || null,
        role,
        origin,
      },
    };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error.message}` };
  }
}
