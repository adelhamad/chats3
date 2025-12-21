// Main application entry point
import fastifyEnv from "@fastify/env";
import fastify from "fastify";

import { envOptions } from "./config/index.js";
import exampleRoutes from "./modules/example/routes.js";

export async function buildApp(opts = {}) {
  const app = fastify({
    logger: true,
    ...opts,
  });

  // Load environment variables
  await app.register(fastifyEnv, envOptions);

  // Health check endpoint
  app.get("/health", async () => {
    return { status: "ok", service: "chats3" };
  });

  // Register example routes
  app.register(exampleRoutes, { prefix: "/api/v1" });

  return app;
}

export async function start() {
  try {
    const app = await buildApp();
    await app.listen({
      port: app.config.PORT,
      host: app.config.HOST,
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// Start server
start();
