// View routes for serving pages
import { validateTicket, parseIntegrators } from "../auth/index.js";
import { createSession } from "../session/index.js";

export default async function viewRoutes(fastify) {
  const integrators = parseIntegrators(fastify.config.INTEGRATORS_JSON);

  // Embed handshake (GET)
  fastify.get("/embed", async (request, reply) => {
    try {
      const { ticket, signature } = request.query;

      if (!ticket || !signature) {
        return reply.status(400).send("Missing ticket or signature");
      }

      const validation = validateTicket(ticket, signature, integrators);
      if (!validation.valid) {
        return reply.status(403).send(validation.error);
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

      if (fastify.config.NODE_ENV === "production") {
        embedCookieOptions.secure = true;
        embedCookieOptions.sameSite = "none";
      } else {
        embedCookieOptions.sameSite = "lax";
      }

      reply.setCookie("sessionId", session.sessionId, embedCookieOptions);

      // Redirect to the room with sessionId in query for isolation (multi-tab/iframe support)
      return reply.redirect(
        `/room/${conversationId}?sessionId=${session.sessionId}`,
      );
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send("Internal Server Error");
    }
  });

  // Join page
  fastify.get("/join", async (request, reply) => {
    return reply.view("join.ejs");
  });

  // Room page
  fastify.get("/room/:conversationId", async (request, reply) => {
    const { conversationId } = request.params;
    return reply.view("room.ejs", { conversationId });
  });

  // Admin page
  fastify.get("/admin", async (request, reply) => {
    return reply.view("admin.ejs");
  });

  // Redirect root to join
  fastify.get("/", async (request, reply) => {
    return reply.redirect("/join");
  });
}
