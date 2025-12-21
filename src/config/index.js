// Environment schema for @fastify/env
export const envSchema = {
  type: "object",
  required: ["PORT", "HOST", "DATABASE_URL"],
  properties: {
    PORT: {
      type: "number",
      default: 3000,
    },
    HOST: {
      type: "string",
      default: "0.0.0.0",
    },
    NODE_ENV: {
      type: "string",
      default: "development",
    },
    DATABASE_URL: {
      type: "string",
    },
  },
};

export const envOptions = {
  confKey: "config",
  schema: envSchema,
  dotenv: true,
};
