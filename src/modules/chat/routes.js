// Chat routes
import crypto from "crypto";

import { z } from "zod";

import { success, fail } from "../../constants/response.js";
import { requireSession } from "../../middleware/index.js";
import { uploadAttachment, getAttachment } from "../attachment/index.js";
import { parseIntegrators, validateTicket } from "../auth/index.js";
import { getConversation, validateJoinCode } from "../conversation/index.js";
import {
  saveMessage,
  saveMessages,
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
} from "../signaling/index.js";

const joinSchema = z.object({
  conversationId: z.string(),
  joinCode: z.string(),
  displayName: z.string().min(1).max(100),
  avatarUrl: z.string().url().optional(),
});

const embedSchema = z.object({
  ticket: z.string(),
  signature: z.string(),
});

const messageSchema = z.object({
  messageId: z.string().uuid().optional(),
  type: z.enum(["text", "system", "file"]).default("text"),
  body: z.string(),
  clientTimestamp: z.string().datetime(),
  // Allow extra fields for file attachments
  attachmentId: z.string().optional(),
  filename: z.string().optional(),
  mimetype: z.string().optional(),
  url: z.string().optional(),
});

const batchMessagesSchema = z.object({
  messages: z.array(messageSchema),
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

export default async function chatRoutes(fastify) {
  const integrators = parseIntegrators(fastify.config.INTEGRATORS_JSON);

  // Manual join
  fastify.post("/join", async (request, reply) => {
    try {
      const { conversationId, joinCode, displayName, avatarUrl } =
        joinSchema.parse(request.body);

      // Validate conversation and join code
      const isValid = await validateJoinCode(conversationId, joinCode);
      if (!isValid) {
        reply.status(403);
        return fail.parse({
          message: "Invalid conversation or join code",
        });
      }

      // Check for duplicate display name
      const existingSessions = getSessionsByConversation(conversationId);
      const isNameTaken = existingSessions.some(
        (s) => s.displayName.toLowerCase() === displayName.toLowerCase(),
      );

      if (isNameTaken) {
        reply.status(409); // Conflict
        return fail.parse({
          message: "Display name is already taken in this conversation",
        });
      }

      // Create session
      const userId = crypto.randomUUID();
      const session = createSession({
        userId,
        displayName,
        avatarUrl,
        role: "user",
        conversationId,
      });

      // Set session cookie
      const cookieOptions = {
        httpOnly: true,
        path: "/",
        maxAge: 24 * 60 * 60, // 24 hours
      };

      // In production, use secure cookies with sameSite none for cross-origin
      if (fastify.config.NODE_ENV === "production") {
        cookieOptions.secure = true;
        cookieOptions.sameSite = "none";
      } else {
        // In development, use lax for same-origin (simpler)
        cookieOptions.sameSite = "lax";
      }

      reply.setCookie("sessionId", session.sessionId, cookieOptions);

      // System message: User joined
      const joinMessage = await saveMessage({
        conversationId,
        senderUserId: "system",
        senderDisplayName: "System",
        senderRole: "system",
        type: "system",
        body: `${displayName} joined the conversation`,
        clientTimestamp: new Date().toISOString(),
      });

      // Broadcast join message
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
    } catch (error) {
      reply.status(400);
      return fail.parse({
        message: error.message,
      });
    }
  });

  // Leave conversation
  fastify.post(
    "/leave",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const { conversationId, userId, displayName, sessionId } =
          request.session;

        // System message: User left
        const leaveMessage = await saveMessage({
          conversationId,
          senderUserId: "system",
          senderDisplayName: "System",
          senderRole: "system",
          type: "system",
          body: `${displayName} left the conversation`,
          clientTimestamp: new Date().toISOString(),
        });

        // Broadcast leave message
        addSignalingEvent(conversationId, {
          type: "new-message",
          fromUserId: "system",
          data: leaveMessage,
        });

        // Broadcast peer-leave event (to clean up WebRTC)
        addSignalingEvent(conversationId, {
          type: "peer-leave",
          fromUserId: userId,
          data: {},
        });

        // Delete session
        if (request.query.keepSession !== "true") {
          deleteSession(sessionId);
          reply.clearCookie("sessionId");
        }

        return success.parse({
          message: "Left conversation",
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
    },
  );

  // Embed handshake
  fastify.post("/embed", async (request, reply) => {
    try {
      const { ticket, signature } = embedSchema.parse(request.body);

      const validation = validateTicket(ticket, signature, integrators);
      if (!validation.valid) {
        reply.status(403);
        return fail.parse({
          message: validation.error,
        });
      }

      const { userId, displayName, avatarUrl, role, conversationId } =
        validation.data;

      // Create session
      const session = createSession({
        userId,
        displayName,
        avatarUrl,
        role,
        conversationId,
      });

      // Set session cookie
      const embedCookieOptions = {
        httpOnly: true,
        path: "/",
        maxAge: 24 * 60 * 60, // 24 hours
      };

      // In production, use secure cookies with sameSite none for cross-origin
      if (fastify.config.NODE_ENV === "production") {
        embedCookieOptions.secure = true;
        embedCookieOptions.sameSite = "none";
      } else {
        // In development, use lax for same-origin (simpler)
        embedCookieOptions.sameSite = "lax";
      }

      reply.setCookie("sessionId", session.sessionId, embedCookieOptions);

      return success.parse({
        message: "Session created",
        details: {
          sessionId: session.sessionId,
          conversationId,
        },
      });
    } catch (error) {
      reply.status(400);
      return fail.parse({
        message: error.message,
      });
    }
  });

  // Save message
  fastify.post(
    "/messages",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const messageData = messageSchema.parse(request.body);

        // Sanitize body
        messageData.body = sanitizeMessageBody(messageData.body);

        // Add sender information from session
        const message = await saveMessage({
          ...messageData,
          conversationId: request.session.conversationId,
          senderUserId: request.session.userId,
          senderDisplayName: request.session.displayName,
          senderAvatarUrl: request.session.avatarUrl,
          senderRole: request.session.role,
        });

        // Broadcast message via signaling (SSE) for multi-tab sync and WebRTC fallback
        addSignalingEvent(request.session.conversationId, {
          type: "new-message",
          fromUserId: request.session.userId,
          data: message,
        });

        return success.parse({
          message: "Message saved",
          details: message,
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
    },
  );

  // Batch save messages (for flush)
  fastify.post(
    "/messages/batch",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const { messages } = batchMessagesSchema.parse(request.body);

        // Sanitize and add sender information
        const messagesWithSender = messages.map((msg) => ({
          ...msg,
          body: sanitizeMessageBody(msg.body),
          conversationId: request.session.conversationId,
          senderUserId: request.session.userId,
          senderDisplayName: request.session.displayName,
          senderRole: request.session.role,
        }));

        const savedMessages = await saveMessages(messagesWithSender);

        return success.parse({
          message: "Messages saved",
          details: { count: savedMessages.length },
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
    },
  );

  // Get message history
  fastify.get(
    "/messages",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const messages = await getConversationMessages(
          request.session.conversationId,
        );

        return success.parse({
          message: "Messages retrieved",
          details: messages,
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
    },
  );

  // Signaling - send event
  fastify.post(
    "/signaling",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const eventData = signalingSchema.parse(request.body);

        const event = addSignalingEvent(request.session.conversationId, {
          ...eventData,
          fromUserId: request.session.userId,
        });

        return success.parse({
          message: "Signaling event added",
          details: { eventId: event.id },
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
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

      // Send initial retry interval and connected event
      reply.raw.write("retry: 3000\n\n");
      reply.raw.write(
        `data: ${JSON.stringify({ type: "system", data: "connected" })}\n\n`,
      );

      // Send missed events if cursor is provided
      const cursor = request.query.cursor || request.headers["last-event-id"];
      if (cursor) {
        const { events } = pollSignalingEvents(conversationId, userId, cursor);

        for (const event of events) {
          // For historical events, we don't send ID to avoid confusing the cursor logic for now
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      }

      // Listener for new events
      const onEvent = (event) => {
        // Filter events: broadcast or targeted to this user
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

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, 15000);

      // Cleanup on close
      request.raw.on("close", () => {
        request.log.info({ msg: "SSE connection closed", userId });
        signalingEmitter.off(`event-${conversationId}`, onEvent);
        clearInterval(heartbeat);
      });

      // Keep the connection open
      return new Promise(() => {
        // Pending promise to keep connection alive
      });
    },
  );

  // Upload attachment
  fastify.post(
    "/attachments",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const data = await request.file();

        if (!data) {
          reply.status(400);
          return fail.parse({
            message: "No file uploaded",
          });
        }

        const buffer = await data.toBuffer();
        const file = {
          filename: data.filename,
          mimetype: data.mimetype,
          file: buffer,
        };

        const attachment = await uploadAttachment(
          request.session.conversationId,
          request.session.userId,
          file,
        );

        return success.parse({
          message: "Attachment uploaded",
          details: attachment,
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
    },
  );

  // Get attachment
  fastify.get(
    "/attachments/:attachmentId",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const { attachmentId } = request.params;
        const { download } = request.query;

        const attachment = await getAttachment(
          request.session.conversationId,
          attachmentId,
        );

        if (!attachment) {
          reply.status(404);
          return fail.parse({
            message: "Attachment not found",
          });
        }

        if (download === "true") {
          return reply.redirect(attachment.signedUrl);
        }

        return success.parse({
          message: "Attachment retrieved",
          details: attachment,
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
    },
  );

  // Get conversation info (for current session)
  fastify.get(
    "/conversation",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const conversation = await getConversation(
          request.session.conversationId,
        );

        if (!conversation) {
          reply.status(404);
          return fail.parse({
            message: "Conversation not found",
          });
        }

        return success.parse({
          message: "Conversation retrieved",
          details: conversation,
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
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
