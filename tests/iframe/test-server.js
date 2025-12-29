import crypto from "crypto";
import http from "http";

const PORT = 4000;
const CHATS3_URL = "https://chat.kasroad.com";
const INTEGRATOR_ID = "test-app";
const INTEGRATOR_SECRET = "test-secret-123";

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chats3 Multi-Peer Iframe Test</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; background: #f0f2f5; margin: 0; }
          .header { text-align: center; padding: 10px; }
          .header h1 { margin: 0 0 10px 0; }
          .controls { 
            display: flex; 
            justify-content: center; 
            gap: 10px; 
            margin: 15px 0;
            flex-wrap: wrap;
          }
          .controls button {
            padding: 10px 20px;
            font-size: 14px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
          }
          .btn-add { background: #0088cc; color: white; }
          .btn-add:hover { background: #006699; }
          .btn-clear { background: #dc3545; color: white; }
          .btn-clear:hover { background: #c82333; }
          .btn-preset { background: #28a745; color: white; }
          .btn-preset:hover { background: #218838; }
          .peer-count {
            display: flex;
            align-items: center;
            gap: 10px;
            background: #fff;
            padding: 8px 15px;
            border-radius: 8px;
            font-weight: 500;
          }
          .chat-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 15px; 
            max-width: 1800px; 
            margin: 0 auto; 
          }
          .chat-column { 
            display: flex; 
            flex-direction: column; 
            background: white; 
            border-radius: 12px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
            overflow: hidden;
            height: 70vh;
            min-height: 400px;
          }
          .chat-header { 
            padding: 10px 15px; 
            background: #0088cc; 
            color: white; 
            font-weight: bold; 
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .chat-header .user-name { font-size: 14px; }
          .chat-header .user-id { font-size: 11px; opacity: 0.8; }
          .btn-remove {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .btn-remove:hover { background: rgba(255,255,255,0.3); }
          iframe { border: none; width: 100%; flex-grow: 1; }
          .instructions { 
            max-width: 900px; 
            margin: 15px auto; 
            background: #e7f3ff; 
            padding: 12px 15px; 
            border-radius: 8px; 
            border: 1px solid #b6d4fe;
            font-size: 13px;
            line-height: 1.5;
          }
          .instructions strong { color: #0056b3; }
          .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #666;
          }
          .empty-state h2 { margin: 0 0 10px 0; color: #999; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🧪 Chats3 Multi-Peer Test</h1>
          <p>Dynamically add peers to test WebRTC signaling with multiple participants</p>
        </div>

        <div class="controls">
          <div class="peer-count">
            Peers: <span id="peerCount">0</span>
          </div>
          <button class="btn-add" onclick="addPeer()">➕ Add Peer</button>
          <button class="btn-preset" onclick="addPreset(2)">👥 2 Peers</button>
          <button class="btn-preset" onclick="addPreset(3)">👥 3 Peers</button>
          <button class="btn-preset" onclick="addPreset(4)">👥 4 Peers</button>
          <button class="btn-clear" onclick="clearAll()">🗑️ Clear All</button>
        </div>

        <div class="instructions">
          <strong>Testing Guide:</strong> 
          Add peers using the buttons above. Each peer gets a unique user ID and session.
          Send messages between peers, start calls with 📞, and observe "Connected (P2P)" status.
          Test reconnection by refreshing individual iframes (right-click → Reload Frame).
        </div>

        <div class="chat-grid" id="chatGrid">
          <div class="empty-state" id="emptyState">
            <h2>No peers yet</h2>
            <p>Click "Add Peer" or use a preset to get started</p>
          </div>
        </div>

        <script>
          const CHATS3_URL = "${CHATS3_URL}";
          const INTEGRATOR_ID = "${INTEGRATOR_ID}";
          const INTEGRATOR_SECRET = "${INTEGRATOR_SECRET}";
          
          const names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack", "Kate", "Leo", "Mia", "Noah", "Olivia", "Paul"];
          const colors = ["#0088cc", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#009688", "#ff5722", "#795548"];
          
          let peerCounter = 0;
          
          function updatePeerCount() {
            const count = document.querySelectorAll('.chat-column').length;
            document.getElementById('peerCount').textContent = count;
            document.getElementById('emptyState').style.display = count === 0 ? 'block' : 'none';
          }
          
          async function generateSignature(ticket) {
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
              'raw',
              encoder.encode(INTEGRATOR_SECRET),
              { name: 'HMAC', hash: 'SHA-256' },
              false,
              ['sign']
            );
            const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ticket));
            return btoa(String.fromCharCode(...new Uint8Array(signature)))
              .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
          }
          
          async function getEmbedUrl(userId, displayName) {
            const ticket = {
              integratorId: INTEGRATOR_ID,
              conversationId: "test-room",
              userId: userId,
              displayName: displayName,
              avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=" + encodeURIComponent(displayName),
              role: "user",
              origin: window.location.origin,
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 3600000).toISOString(),
              nonce: crypto.randomUUID(),
            };
            
            const ticketJson = JSON.stringify(ticket);
            const signature = await generateSignature(ticketJson);
            
            return CHATS3_URL + "/embed?ticket=" + encodeURIComponent(ticketJson) + "&signature=" + encodeURIComponent(signature);
          }
          
          async function addPeer() {
            const name = names[peerCounter % names.length];
            const color = colors[peerCounter % colors.length];
            const uniqueId = "user-" + Date.now() + "-" + peerCounter;
            const displayName = name + " #" + (peerCounter + 1);
            
            const url = await getEmbedUrl(uniqueId, displayName);
            
            const column = document.createElement('div');
            column.className = 'chat-column';
            column.id = 'peer-' + peerCounter;
            column.innerHTML = \`
              <div class="chat-header" style="background: \${color}">
                <div>
                  <div class="user-name">\${displayName}</div>
                  <div class="user-id">\${uniqueId}</div>
                </div>
                <button class="btn-remove" onclick="removePeer('\${column.id}')" title="Remove peer">✕</button>
              </div>
              <iframe src="\${url}"></iframe>
            \`;
            
            document.getElementById('chatGrid').appendChild(column);
            peerCounter++;
            updatePeerCount();
          }
          
          function removePeer(id) {
            const el = document.getElementById(id);
            if (el) {
              el.remove();
              updatePeerCount();
            }
          }
          
          function clearAll() {
            document.querySelectorAll('.chat-column').forEach(el => el.remove());
            peerCounter = 0;
            updatePeerCount();
          }
          
          async function addPreset(count) {
            clearAll();
            for (let i = 0; i < count; i++) {
              await addPeer();
            }
          }
          
          updatePeerCount();
        </script>
      </body>
      </html>
    `);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(\`Iframe test server running at http://localhost:\${PORT}\`);
  console.log(\`Make sure Chats3 is running at \${CHATS3_URL}\`);
});
