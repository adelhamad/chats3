// Admin routes
import { z } from "zod";

import { success, fail } from "../../constants/response.js";
import {
  createConversation,
  getConversation,
  closeConversation,
  generateConversationId,
} from "../conversation/index.js";

const createConversationSchema = z.object({
  adminPassword: z.string(),
  conversationId: z
    .string()
    .regex(/^[a-zA-Z0-9-_]+$/)
    .optional(),
});

const closeConversationSchema = z.object({
  adminPassword: z.string(),
});

const viewConversationSchema = z.object({
  adminPassword: z.string(),
});

export default async function adminRoutes(fastify) {
  const verifyAdminPassword = (password) => {
    if (password !== fastify.config.ADMIN_PASSWORD) {
      throw new Error("Invalid admin password");
    }
  };

  const rateLimit = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };

  // Create conversation
  fastify.post("/admin/conversations", rateLimit, async (request) => {
    const { adminPassword, conversationId } = createConversationSchema.parse(
      request.body,
    );
    verifyAdminPassword(adminPassword);
    const convId = conversationId || generateConversationId();
    const conversation = await createConversation(convId);
    return success.parse({
      message: "Conversation created",
      details: conversation,
    });
  });

  // Get conversation details
  fastify.post(
    "/admin/conversations/:conversationId",
    rateLimit,
    async (request, reply) => {
      const { conversationId } = request.params;
      const { adminPassword } = viewConversationSchema.parse(request.body);
      verifyAdminPassword(adminPassword);

      const conversation = await getConversation(conversationId);
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

  // Close conversation
  fastify.post(
    "/admin/conversations/:conversationId/close",
    rateLimit,
    async (request) => {
      const { conversationId } = request.params;
      const { adminPassword } = closeConversationSchema.parse(request.body);
      verifyAdminPassword(adminPassword);
      const conversation = await closeConversation(conversationId);
      return success.parse({
        message: "Conversation closed",
        details: conversation,
      });
    },
  );
}
