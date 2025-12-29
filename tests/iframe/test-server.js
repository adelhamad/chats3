import crypto from "crypto";
import http from "http";

const PORT = 4000;
const CHATS3_URL = "https://chat.kasroad.com";
const INTEGRATOR_ID = "test-app";
const INTEGRATOR_SECRET = "test-secret-123";

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    // Helper to generate a signed embed URL
    const getEmbedUrl = (userId, displayName, avatarUrl) => {
      const ticket = {
        integratorId: INTEGRATOR_ID,
        conversationId: "test-room",
        userId: userId,
        displayName: displayName,
        avatarUrl: avatarUrl,
        role: "user",
        origin: `http://localhost:${PORT}`,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        nonce: crypto.randomUUID(),
      };

      const ticketJson = JSON.stringify(ticket);
      const signature = crypto
        .createHmac("sha256", INTEGRATOR_SECRET)
        .update(ticketJson)
        .digest("base64url");

      return `${CHATS3_URL}/embed?ticket=${encodeURIComponent(ticketJson)}&signature=${encodeURIComponent(signature)}`;
    };

    const urlA = getEmbedUrl(
      "user-alpha",
      "Alice (Alpha)",
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
    );
    const urlB = getEmbedUrl(
      "user-beta",
      "Bob (Beta)",
      "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
    );

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chats3 Multi-Peer Iframe Test</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background: #f0f2f5; margin: 0; }
          .header { text-align: center; padding: 20px; }
          .chat-grid { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 20px; 
            max-width: 1400px; 
            margin: 0 auto; 
            height: 80vh;
          }
          .chat-column { 
            display: flex; 
            flex-direction: column; 
            background: white; 
            border-radius: 12px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
            overflow: hidden;
          }
          .chat-label { 
            padding: 10px; 
            background: #0088cc; 
            color: white; 
            font-weight: bold; 
            text-align: center;
          }
          iframe { border: none; width: 100%; flex-grow: 1; }
          .instructions { 
            max-width: 800px; 
            margin: 20px auto; 
            background: #fff3cd; 
            padding: 15px; 
            border-radius: 8px; 
            border: 1px solid #ffeeba;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Chats3 Multi-Peer Iframe Test</h1>
          <p>Simulating two different users in the same conversation via secure iframes.</p>
        </div>

        <div class="instructions">
          <strong>How to test:</strong> 
          1. Type a message in Alice's window and see it appear in Bob's. 
          2. Click the 📞 button in one window to start a WebRTC call between the iframes.
          3. Notice the "Connected (P2P)" status when WebRTC is established.
        </div>

        <div class="chat-grid">
          <div class="chat-column">
            <div class="chat-label">User: Alice</div>
            <iframe src="${urlA}"></iframe>
          </div>
          <div class="chat-column">
            <div class="chat-label">User: Bob</div>
            <iframe src="${urlB}"></iframe>
          </div>
        </div>
      </body>
      </html>
    `);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Iframe test server running at http://localhost:${PORT}`);
  console.log(`Make sure Chats3 is running at ${CHATS3_URL}`);
});
