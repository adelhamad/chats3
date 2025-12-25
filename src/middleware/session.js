// Session validation middleware
import { getSession } from "../modules/session/index.js";

export async function requireSession(request, reply) {
  // Check header first, then query param (for SSE), then cookie
  const sessionId =
    request.headers["x-session-id"] ||
    request.query.sessionId ||
    request.cookies.sessionId;

  if (!sessionId) {
    reply.status(401).send({
      success: false,
      message: "No session found",
    });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    reply.status(401).send({
      success: false,
      message: "Invalid session",
    });
    return;
  }

  // Attach session to request
  request.session = session;
}
