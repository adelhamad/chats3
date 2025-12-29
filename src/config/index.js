// Environment schema for @fastify/env
export const envSchema = {
  type: "object",
  required: ["PORT", "S3_BUCKET"],
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
    S3_ENDPOINT: {
      type: "string",
      default: "https://s3.amazonaws.com",
    },
    S3_REGION: {
      type: "string",
      default: "us-east-1",
    },
    S3_BUCKET: {
      type: "string",
    },
    S3_ACCESS_KEY: {
      type: "string",
      default: "",
    },
    S3_SECRET_KEY: {
      type: "string",
      default: "",
    },
  },
};

export const envOptions = {
  confKey: "config",
  schema: envSchema,
  dotenv: true,
};
