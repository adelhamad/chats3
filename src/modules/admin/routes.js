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
  conversationId: z.string().optional(),
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

  // Create conversation
  fastify.post("/admin/conversations", async (request, reply) => {
    try {
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
    } catch (error) {
      reply.status(400);
      return fail.parse({
        message: error.message,
      });
    }
  });

  // Get conversation details
  fastify.post(
    "/admin/conversations/:conversationId",
    async (request, reply) => {
      try {
        const { conversationId } = request.params;
        const { adminPassword } = viewConversationSchema.parse(request.body);
        verifyAdminPassword(adminPassword);

        const conversation = await getConversation(conversationId);
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

  // Close conversation
  fastify.post(
    "/admin/conversations/:conversationId/close",
    async (request, reply) => {
      try {
        const { conversationId } = request.params;
        const { adminPassword } = closeConversationSchema.parse(request.body);
        verifyAdminPassword(adminPassword);

        const conversation = await closeConversation(conversationId);

        return success.parse({
          message: "Conversation closed",
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
}
