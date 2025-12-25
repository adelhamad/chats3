// Main application entry point
import path from "path";
import { fileURLToPath } from "url";

import fastifyCookie from "@fastify/cookie";
import fastifyEnv from "@fastify/env";
import fastifyFormBody from "@fastify/formbody";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import ejs from "ejs";
import fastify from "fastify";

import { envOptions } from "./config/index.js";
import { adminRoutes } from "./modules/admin/index.js";
import { parseIntegrators } from "./modules/auth/index.js";
import { chatRoutes } from "./modules/chat/index.js";
import { initializeS3 } from "./modules/storage/index.js";
import { viewRoutes } from "./modules/ui/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildApp(opts = {}) {
  const app = fastify({
    logger: true,
    ...opts,
  });

  // Load environment variables
  await app.register(fastifyEnv, envOptions);

  // Initialize S3
  initializeS3(app.config);

  // Register plugins
  await app.register(fastifyCookie, {
    secret: "adel",
  });

  await app.register(fastifyFormBody);

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Static files (for serving client-side assets)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "modules/ui/public"),
    prefix: "/public/",
  });

  // View engine (EJS)
  await app.register(fastifyView, {
    engine: {
      ejs,
    },
    root: path.join(__dirname, "modules/ui/views"),
  });

  // Security headers
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-XSS-Protection", "1; mode=block");

    // Dynamic frame-ancestors based on integrators
    const integrators = parseIntegrators(app.config.INTEGRATORS_JSON);
    const allowedOrigins = Array.from(integrators.values())
      .flatMap((i) => i.allowedOrigins)
      .join(" ");

    const frameAncestors = allowedOrigins
      ? `'self' ${allowedOrigins}`
      : "'self'";

    reply.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors ${frameAncestors};`,
    );

    if (app.config.NODE_ENV === "production") {
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  });

  // Health check endpoint
  app.get("/health", async () => {
    return { status: "ok", service: "chats3" };
  });

  // Register routes
  app.register(viewRoutes); // No prefix for view routes
  app.register(chatRoutes, { prefix: "/api/v1" });
  app.register(adminRoutes, { prefix: "/api/v1" });

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

// Start server if not in test mode
if (process.env.NODE_ENV !== "test") {
  start();
}
