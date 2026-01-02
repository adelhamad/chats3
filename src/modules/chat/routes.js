// Chat routes
import crypto from "crypto";

import { z } from "zod";

import { MAX_PARTICIPANTS } from "../../constants/index.js";
import { success, fail } from "../../constants/response.js";
import { requireSession } from "../../middleware/index.js";
import { uploadAttachment, getAttachment } from "../attachment/index.js";
import { getIntegratorsMap, validateTicket } from "../auth/index.js";
import { getConversation, validateJoinCode } from "../conversation/index.js";
import {
  saveMessage,
  getConversationMessages,
  sanitizeMessageBody,
} from "../message/index.js";
import {
  createSession,
  deleteSession,
  getSessionsByConversation,
} from "../session/index.js";
import {
  addSignalingEvent,
  pollSignalingEvents,
  signalingEmitter,
  addParticipant,
  removeParticipant,
  getParticipants,
} from "../signaling/index.js";
import { putReactions, getReactions } from "../storage/index.js";

const joinSchema = z.object({
  conversationId: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9-_]+$/),
  joinCode: z
    .string()
    .length(6)
    .regex(/^[A-Z0-9]+$/),
  displayName: z.string().min(1).max(50).trim(),
  avatarUrl: z.string().url().max(500).optional(),
});

const embedSchema = z.object({
  ticket: z.string(),
  signature: z.string(),
});

const messageSchema = z.object({
  messageId: z.string().uuid().optional(),
  type: z.enum(["text", "system", "file"]).default("text"),
  body: z.string().max(10000),
  clientTimestamp: z.string().datetime(),
  // Allow extra fields for file attachments
  attachmentId: z.string().max(100).optional(),
  filename: z.string().max(255).optional(),
  mimetype: z.string().max(100).optional(),
  url: z.string().max(2048).optional(), // Relative or absolute URL
});

const signalingSchema = z.object({
  type: z.enum([
    "peer-join",
    "peer-leave",
    "offer",
    "answer",
    "ice-candidate",
    "new-message",
    "end-call",
  ]),
  toUserId: z.string().nullish(),
  data: z.any(),
});

const reactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().max(10),
  added: z.boolean(),
});

const systemMessageSchema = z.object({
  integratorId: z.string().min(1).max(100),
  conversationId: z.string().max(100),
  body: z.string().min(1).max(1000),
  signature: z.string().min(1),
  timestamp: z.string().datetime(),
});

// Remove a user from all emojis on a message
function removeUserFromAllEmojis(messageReactions, userId) {
  for (const e of Object.keys(messageReactions)) {
    const idx = messageReactions[e].indexOf(userId);
    if (idx !== -1) {
      messageReactions[e].splice(idx, 1);
      if (messageReactions[e].length === 0) {
        delete messageReactions[e];
      }
    }
  }
}

// Helper to update reaction data (mutates reactions object)
function updateReactionData(reactions, messageId, emoji, userId, added) {
  if (!reactions[messageId]) {
    reactions[messageId] = {};
  }

  if (added) {
    removeUserFromAllEmojis(reactions[messageId], userId);
    if (!reactions[messageId][emoji]) {
      reactions[messageId][emoji] = [];
    }
    if (!reactions[messageId][emoji].includes(userId)) {
      reactions[messageId][emoji].push(userId);
    }
  } else if (reactions[messageId][emoji]) {
    const idx = reactions[messageId][emoji].indexOf(userId);
    if (idx !== -1) {
      reactions[messageId][emoji].splice(idx, 1);
      if (reactions[messageId][emoji].length === 0) {
        delete reactions[messageId][emoji];
      }
    }
  }

  if (Object.keys(reactions[messageId]).length === 0) {
    delete reactions[messageId];
  }
}

// Cookie options helper
const getCookieOpts = (isProd) => ({
  httpOnly: true,
  path: "/",
  maxAge: 86400,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
});

export default async function chatRoutes(fastify) {
  const integrators = getIntegratorsMap();
  const isProd = fastify.config.NODE_ENV === "production";

  // Manual join
  fastify.post("/join", async (request, reply) => {
    const { conversationId, joinCode, displayName, avatarUrl } =
      joinSchema.parse(request.body);

    const isValid = await validateJoinCode(conversationId, joinCode);
    if (!isValid) {
      reply.status(403);
      return fail.parse({ message: "Invalid conversation or join code" });
    }

    const existingSessions = getSessionsByConversation(conversationId);
    const activeParticipants = getParticipants(conversationId);

    // Check participant limit (only count active participants)
    if (activeParticipants.length >= MAX_PARTICIPANTS) {
      reply.status(403);
      return fail.parse({
        message: "Conversation is full",
        details: { maxParticipants: MAX_PARTICIPANTS },
      });
    }

    // Check if name is taken by an ACTIVE participant
    const nameTakenByActiveUser = existingSessions.some(
      (s) =>
        s.displayName.toLowerCase() === displayName.toLowerCase() &&
        activeParticipants.includes(s.userId),
    );

    if (nameTakenByActiveUser) {
      reply.status(409);
      return fail.parse({
        message: "Display name is already taken in this conversation",
      });
    }

    // If name is taken by an INACTIVE user, we can proceed (new session will be created)
    // Ideally we should clean up the old session, but it will expire eventually.
    // Or we could find and delete it here.
    const inactiveSession = existingSessions.find(
      (s) =>
        s.displayName.toLowerCase() === displayName.toLowerCase() &&
        !activeParticipants.includes(s.userId),
    );

    if (inactiveSession) {
      deleteSession(inactiveSession.sessionId);
    }

    const session = createSession({
      userId: crypto.randomUUID(),
      displayName,
      avatarUrl,
      role: "user",
      conversationId,
    });

    reply.setCookie("sessionId", session.sessionId, getCookieOpts(isProd));

    const joinMessage = await saveMessage({
      conversationId,
      senderUserId: "system",
      senderDisplayName: "System",
      senderRole: "system",
      type: "system",
      body: `${displayName} joined the conversation`,
      clientTimestamp: new Date().toISOString(),
    });

    addSignalingEvent(conversationId, {
      type: "new-message",
      fromUserId: "system",
      data: joinMessage,
    });

    return success.parse({
      message: "Joined conversation",
      details: {
        sessionId: session.sessionId,
        userId: session.userId,
        conversationId,
      },
    });
  });

  // Leave conversation
  fastify.post(
    "/leave",
    { preHandler: requireSession },
    async (request, reply) => {
      const { conversationId, userId, displayName, sessionId } =
        request.session;

      const leaveMessage = await saveMessage({
        conversationId,
        senderUserId: "system",
        senderDisplayName: "System",
        senderRole: "system",
        type: "system",
        body: `${displayName} left the conversation`,
        clientTimestamp: new Date().toISOString(),
      });

      addSignalingEvent(conversationId, {
        type: "new-message",
        fromUserId: "system",
        data: leaveMessage,
      });
      addSignalingEvent(conversationId, {
        type: "peer-leave",
        fromUserId: userId,
        data: {},
      });

      deleteSession(sessionId);
      reply.clearCookie("sessionId");

      return success.parse({ message: "Left conversation" });
    },
  );

  // Embed handshake
  fastify.post("/embed", async (request, reply) => {
    const { ticket, signature } = embedSchema.parse(request.body);

    const validation = validateTicket(ticket, signature, integrators);
    if (!validation.valid) {
      reply.status(403);
      return fail.parse({ message: validation.error });
    }

    const { userId, displayName, avatarUrl, role, conversationId } =
      validation.data;
    const session = createSession({
      userId,
      displayName,
      avatarUrl,
      role,
      conversationId,
    });
    reply.setCookie("sessionId", session.sessionId, getCookieOpts(isProd));

    return success.parse({
      message: "Session created",
      details: { sessionId: session.sessionId, conversationId },
    });
  });

  // Save message
  fastify.post("/messages", { preHandler: requireSession }, async (request) => {
    const messageData = messageSchema.parse(request.body);
    messageData.body = sanitizeMessageBody(messageData.body);

    const message = await saveMessage({
      ...messageData,
      conversationId: request.session.conversationId,
      senderUserId: request.session.userId,
      senderDisplayName: request.session.displayName,
      senderAvatarUrl: request.session.avatarUrl,
      senderRole: request.session.role,
    });

    addSignalingEvent(request.session.conversationId, {
      type: "new-message",
      fromUserId: request.session.userId,
      data: message,
    });

    return success.parse({ message: "Message saved", details: message });
  });

  // Send system message (authenticated parent only)
  fastify.post("/system-message", async (request, reply) => {
    const { integratorId, conversationId, body, signature, timestamp } =
      systemMessageSchema.parse(request.body);

    // Verify integrator exists
    const integrator = integrators.get(integratorId);
    if (!integrator) {
      reply.status(403);
      return fail.parse({ message: "Unknown integrator" });
    }

    // Verify signature
    const payload = JSON.stringify({
      integratorId,
      conversationId,
      body,
      timestamp,
    });
    const expectedSignature = crypto
      .createHmac("sha256", integrator.secret)
      .update(payload)
      .digest("base64url");

    if (signature !== expectedSignature) {
      reply.status(403);
      return fail.parse({ message: "Invalid signature" });
    }

    // Check timestamp (must be within 60 seconds)
    const now = Date.now();
    const timestampMs = new Date(timestamp).getTime();
    if (Math.abs(now - timestampMs) > 60000) {
      reply.status(403);
      return fail.parse({ message: "Request timestamp too old or in future" });
    }

    // Save and broadcast system message
    // Note: We don't verify conversation exists - if there are no active sessions,
    // the message will be saved but not received until someone joins
    const message = await saveMessage({
      conversationId,
      senderUserId: "system",
      senderDisplayName: "System",
      senderRole: "system",
      type: "system",
      body: sanitizeMessageBody(body),
      clientTimestamp: timestamp,
    });

    addSignalingEvent(conversationId, {
      type: "new-message",
      fromUserId: "system",
      data: message,
    });

    return success.parse({ message: "System message sent", details: message });
  });

  // Get message history
  fastify.get("/messages", { preHandler: requireSession }, async (request) => {
    const messages = await getConversationMessages(
      request.session.conversationId,
    );
    return success.parse({ message: "Messages retrieved", details: messages });
  });

  // Get reactions
  fastify.get("/reactions", { preHandler: requireSession }, async (request) => {
    const reactions = await getReactions(request.session.conversationId);
    return success.parse({
      message: "Reactions retrieved",
      details: reactions,
    });
  });

  // Save reaction
  fastify.post(
    "/reactions",
    { preHandler: requireSession },
    async (request) => {
      const { messageId, emoji, added } = reactionSchema.parse(request.body);
      const { conversationId, userId } = request.session;

      const reactions = await getReactions(conversationId);
      updateReactionData(reactions, messageId, emoji, userId, added);
      await putReactions(conversationId, reactions);

      return success.parse({ message: "Reaction saved" });
    },
  );

  // Signaling - send event
  fastify.post(
    "/signaling",
    { preHandler: requireSession },
    async (request) => {
      const eventData = signalingSchema.parse(request.body);
      const event = addSignalingEvent(request.session.conversationId, {
        ...eventData,
        fromUserId: request.session.userId,
      });
      return success.parse({
        message: "Signaling event added",
        details: { eventId: event.id },
      });
    },
  );

  // Signaling - SSE stream
  fastify.get(
    "/signaling",
    { preHandler: requireSession },
    async (request, reply) => {
      const { conversationId, userId } = request.session;
      request.log.info({
        msg: "SSE connection attempt",
        userId,
        conversationId,
      });

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      reply.raw.write("retry: 3000\n\n");
      reply.raw.write(
        `data: ${JSON.stringify({ type: "system", data: "connected" })}\n\n`,
      );

      // Add to active participants
      addParticipant(conversationId, userId);

      // Send current room state (active participants with details)
      const activeUserIds = getParticipants(conversationId);
      const allSessions = getSessionsByConversation(conversationId);

      const participantsDetails = activeUserIds.map((uid) => {
        const session = allSessions.find((s) => s.userId === uid);
        return {
          userId: uid,
          displayName: session ? session.displayName : "Unknown",
          isMe: uid === userId,
        };
      });

      reply.raw.write(
        `data: ${JSON.stringify({
          type: "room-state",
          data: { participants: participantsDetails },
        })}\n\n`,
      );

      const cursor = request.query.cursor || request.headers["last-event-id"];
      if (cursor) {
        const { events } = pollSignalingEvents(conversationId, userId, cursor);
        for (const event of events) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      }

      const onEvent = (event) => {
        // Don't echo broadcast events back to sender (peer-join, peer-leave, new-message)
        if (!event.toUserId && event.fromUserId === userId) {
          return;
        }
        // Send if: broadcast (no toUserId), or targeted to this user, or sent by this user (for targeted events like offer/answer)
        if (
          !event.toUserId ||
          event.toUserId === userId ||
          event.fromUserId === userId
        ) {
          request.log.info({
            msg: "SSE sending event",
            userId,
            type: event.type,
          });
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };

      signalingEmitter.on(`event-${conversationId}`, onEvent);

      const heartbeat = setInterval(
        () => reply.raw.write(": heartbeat\n\n"),
        15000,
      );

      request.raw.on("close", () => {
        request.log.info({ msg: "SSE connection closed", userId });
        signalingEmitter.off(`event-${conversationId}`, onEvent);
        clearInterval(heartbeat);

        // Remove from active participants
        // Only broadcast leave if this was the last connection for this user
        const isFullyDisconnected = removeParticipant(conversationId, userId);

        if (isFullyDisconnected) {
          // Add a grace period before broadcasting peer-leave
          // This handles page refresh scenarios where the new connection
          // should be established before we broadcast the leave
          setTimeout(() => {
            // Check if user has reconnected during the grace period
            const currentParticipants = getParticipants(conversationId);
            if (!currentParticipants.includes(userId)) {
              // User is still disconnected, broadcast peer-leave
              request.log.info({
                msg: "User fully disconnected, broadcasting peer-leave",
                userId,
              });
              addSignalingEvent(conversationId, {
                type: "peer-leave",
                fromUserId: userId,
                data: {},
              });
            }
          }, 3000); // 3 second grace period for refresh
        }
      });

      // eslint-disable-next-line no-empty-function
      return new Promise(() => {});
    },
  );

  // Upload attachment
  fastify.post(
    "/attachments",
    { preHandler: requireSession },
    async (request, reply) => {
      const data = await request.file();
      if (!data) {
        reply.status(400);
        return fail.parse({ message: "No file uploaded" });
      }

      const buffer = await data.toBuffer();
      const attachment = await uploadAttachment(
        request.session.conversationId,
        request.session.userId,
        { filename: data.filename, mimetype: data.mimetype, file: buffer },
      );

      return success.parse({
        message: "Attachment uploaded",
        details: attachment,
      });
    },
  );

  // Get attachment
  fastify.get(
    "/attachments/:attachmentId",
    { preHandler: requireSession },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const attachment = await getAttachment(
        request.session.conversationId,
        attachmentId,
      );

      if (!attachment) {
        reply.status(404);
        return fail.parse({ message: "Attachment not found" });
      }

      if (request.query.download === "true") {
        return reply.redirect(attachment.signedUrl);
      }

      return success.parse({
        message: "Attachment retrieved",
        details: attachment,
      });
    },
  );

  // Get conversation info
  fastify.get(
    "/conversation",
    { preHandler: requireSession },
    async (request, reply) => {
      const conversation = await getConversation(
        request.session.conversationId,
      );
      if (!conversation) {
        reply.status(404);
        return fail.parse({ message: "Conversation not found" });
      }
      return success.parse({
        message: "Conversation retrieved",
        details: conversation,
      });
    },
  );

  // Get session info
  fastify.get("/session", { preHandler: requireSession }, async (request) => {
    return success.parse({
      message: "Session retrieved",
      details: request.session,
    });
  });
}
