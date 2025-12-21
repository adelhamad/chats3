// Standardized API response helpers
import crypto from "crypto";

import { z } from "zod";

// Meta schema
export const MetaSchema = z.object({
  requestId: z.uuid(),
  timestamp: z.iso.datetime(),
});

// API Response schema (for validation)
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  details: z.any().optional(),
  meta: MetaSchema,
});

// Generate meta
const withMeta = (data) => ({
  ...data,
  meta: {
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  },
});

// Success response transformer
// Usage: success.parse({ message: "Created", details: { id: 1 } })
export const success = z
  .object({
    message: z.string().optional().default(""),
    details: z.any().optional(),
  })
  .transform((data) => withMeta({ success: true, ...data }));

// Error response transformer
// Usage: fail.parse({ message: "Not found" })
// Usage: fail.parse({ message: "Validation failed", details: errors })
export const fail = z
  .object({
    message: z.string(),
    details: z.any().optional(),
  })
  .transform((data) => withMeta({ success: false, ...data }));
