// View routes for serving pages
import { validateTicket, getIntegratorsMap } from "../auth/index.js";
import { createSession } from "../session/index.js";

const getCookieOpts = (isProd) => ({
  httpOnly: true,
  path: "/",
  maxAge: 86400,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
});

export default async function viewRoutes(fastify) {
  const integrators = getIntegratorsMap();
  const isProd = fastify.config.NODE_ENV === "production";

  // Embed handshake (GET)
  fastify.get("/embed", async (request, reply) => {
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
    const session = createSession({
      userId,
      displayName,
      avatarUrl,
      role,
      conversationId,
    });
    reply.setCookie("sessionId", session.sessionId, getCookieOpts(isProd));
    return reply.redirect(
      `/room/${conversationId}?sessionId=${session.sessionId}`,
    );
  });

  // Join page
  fastify.get("/join", (request, reply) => reply.view("join.ejs"));

  // Room page
  fastify.get("/room/:conversationId", (request, reply) => {
    return reply.view("room.ejs", {
      conversationId: request.params.conversationId,
    });
  });

  // Admin page
  fastify.get("/admin", (request, reply) => reply.view("admin.ejs"));

  // Redirect root to join
  fastify.get("/", (request, reply) => reply.redirect("/join"));
}
