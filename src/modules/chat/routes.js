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
import { createSession } from "../session/index.js";
import { addSignalingEvent, pollSignalingEvents } from "../signaling/index.js";

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
});

const batchMessagesSchema = z.object({
  messages: z.array(messageSchema),
});

const signalingSchema = z.object({
  type: z.enum(["peer-join", "peer-leave", "offer", "answer", "ice-candidate"]),
  toUserId: z.string().optional(),
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
      reply.setCookie("sessionId", session.sessionId, {
        httpOnly: true,
        secure: fastify.config.NODE_ENV === "production",
        sameSite: "none",
        path: "/",
        maxAge: 24 * 60 * 60, // 24 hours
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
      reply.setCookie("sessionId", session.sessionId, {
        httpOnly: true,
        secure: fastify.config.NODE_ENV === "production",
        sameSite: "none",
        path: "/",
        maxAge: 24 * 60 * 60, // 24 hours
      });

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
          senderRole: request.session.role,
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

  // Signaling - poll events
  fastify.get(
    "/signaling",
    { preHandler: requireSession },
    async (request, reply) => {
      try {
        const { cursor } = request.query;

        const result = pollSignalingEvents(
          request.session.conversationId,
          request.session.userId,
          cursor,
        );

        return success.parse({
          message: "Events retrieved",
          details: result,
        });
      } catch (error) {
        reply.status(400);
        return fail.parse({
          message: error.message,
        });
      }
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
