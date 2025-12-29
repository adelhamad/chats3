// Application-level constants

// Limits
export const MAX_PARTICIPANTS = 50;

// Admin password (hardcoded for simplicity)
// eslint-disable-next-line sonarjs/no-hardcoded-passwords
export const ADMIN_PASSWORD = "adel";

// Integrators configuration
// Add your integrators here: { id, secret, allowedOrigins[] }
export const INTEGRATORS = [
  {
    id: "test-app",
    secret: "test-secret-123",
    allowedOrigins: ["http://localhost:4000"],
  },
];
