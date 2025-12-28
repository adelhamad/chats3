// Standardized API response helpers
import crypto from "crypto";

/**
 * Generate response metadata
 * @returns {object} Meta object with requestId and timestamp
 */
function getMeta() {
  return {
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a success response
 * @param {string} message - Response message
 * @param {any} details - Response payload
 * @returns {object} Standardized success response
 */
export function successResponse(message = "", details = undefined) {
  return {
    success: true,
    message,
    details,
    meta: getMeta(),
  };
}

/**
 * Create an error response
 * @param {string} message - Error message
 * @param {any} details - Error details (e.g., validation errors)
 * @returns {object} Standardized error response
 */
export function errorResponse(message, details = undefined) {
  return {
    success: false,
    message,
    details,
    meta: getMeta(),
  };
}

// Backward compatible exports (wraps new functions with .parse() interface)
// This allows gradual migration - can be removed once all code is updated
export const success = {
  parse: ({ message = "", details } = {}) => successResponse(message, details),
};

export const fail = {
  parse: ({ message, details } = {}) => errorResponse(message, details),
};
