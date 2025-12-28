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

// Cookie options helper
const getCookieOpts = (isProd) => ({
  httpOnly: true,
  path: "/",
  maxAge: 86400,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
});

export default async function chatRoutes(fastify) {
  const integrators = parseIntegrators(fastify.config.INTEGRATORS_JSON);
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
    if (
      existingSessions.some(
        (s) => s.displayName.toLowerCase() === displayName.toLowerCase(),
      )
    ) {
      reply.status(409);
      return fail.parse({
        message: "Display name is already taken in this conversation",
      });
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

  // Get message history
  fastify.get("/messages", { preHandler: requireSession }, async (request) => {
    const messages = await getConversationMessages(
      request.session.conversationId,
    );
    return success.parse({ message: "Messages retrieved", details: messages });
  });

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

      const cursor = request.query.cursor || request.headers["last-event-id"];
      if (cursor) {
        const { events } = pollSignalingEvents(conversationId, userId, cursor);
        for (const event of events) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      }

      const onEvent = (event) => {
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

        // Broadcast peer-leave when SSE disconnects (tab close, network loss, etc.)
        addSignalingEvent(conversationId, {
          type: "peer-leave",
          fromUserId: userId,
          data: {},
        });
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
