// Main application entry point
import path from "path";
import { fileURLToPath } from "url";

import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
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
import { getIntegratorsMap } from "./modules/auth/index.js";
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

  // Register CORS - allow requests from integrator origins
  const integrators = getIntegratorsMap();
  const allowedOrigins = Array.from(integrators.values()).flatMap(
    (i) => i.allowedOrigins,
  );

  await app.register(fastifyCors, {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) {
        return callback(null, true);
      }
      // Check if origin is in allowed list
      if (
        allowedOrigins.some((pattern) => {
          if (pattern === origin) {
            return true;
          }
          // Support wildcard patterns
          if (pattern.includes("*.")) {
            // Pattern matching for allowed origins - not actual HTTP usage
            const baseDomain = pattern
              .replace("https://*.", "")
              // eslint-disable-next-line sonarjs/no-clear-text-protocols
              .replace("http://*.", "");
            // Check if origin ends with the base domain (e.g., example.com)
            // or is exactly the base domain
            return (
              origin === `https://${baseDomain}` ||
              origin === `http://${baseDomain}` ||
              origin.endsWith(`.${baseDomain}`)
            );
          }
          return false;
        })
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  });

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
    max: 300,
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
    const integrators = getIntegratorsMap();
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

  // Global error handler - removes need for try-catch in every route
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode || 400;
    return reply.status(statusCode).send({
      success: false,
      message: error.message,
      meta: {
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
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

    // Graceful shutdown handler
    const shutdown = async (signal) => {
      app.log.info({ signal }, "Shutting down...");
      await app.close();
      process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

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
