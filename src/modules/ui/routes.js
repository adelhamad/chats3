// View routes for serving pages
export default async function viewRoutes(fastify) {
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
