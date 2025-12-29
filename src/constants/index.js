// Application-level constants

// Limits
export const MAX_PARTICIPANTS = 50;

// Admin password (hardcoded for simplicity)
// eslint-disable-next-line sonarjs/no-hardcoded-passwords
export const ADMIN_PASSWORD = "adel";

// Integrators configuration
// Add your integrators here: { id, secret, allowedOrigins[] }
// Supports: exact URLs, wildcard subdomains (https://*.domain.com)
export const INTEGRATORS = [
  {
    id: "test-app",
    secret: "test-secret-123",
    allowedOrigins: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:4000",
      "http://localhost:5173",
      "https://*.vercel.app",
      "https://kasroad.com",
      "https://www.kasroad.com",
      "https://kazawallet.com",
      "https://www.kazawallet.com",
    ],
  },
];
