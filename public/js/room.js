// Room WebRTC client
const conversationId = window.CONVERSATION_ID;
let sessionInfo = null;
let peerConnections = new Map(); // userId -> RTCPeerConnection
let dataChannels = new Map(); // userId -> RTCDataChannel
let signalingCursor = null;
let messageOutbox = [];

const messagesDiv = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const statusSpan = document.getElementById('connectionStatus');
const userNameSpan = document.getElementById('userName');

// Initialize
async function init() {
  try {
    // Get session info
    const sessionResponse = await fetch('/api/v1/session', {
      credentials: 'include',
    });
    const sessionData = await sessionResponse.json();
    
    if (!sessionData.success) {
      alert('No valid session. Please join again.');
      window.location.href = '/join';
      return;
    }

    sessionInfo = sessionData.details;
    userNameSpan.textContent = sessionInfo.displayName;

    // Load message history
    await loadMessageHistory();

    // Start signaling poll
    startSignalingPoll();

    // Announce peer join
    await sendSignalingEvent('peer-join', null, {
      userId: sessionInfo.userId,
      displayName: sessionInfo.displayName,
    });

    // Set up send button
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });

    // Set up beforeunload flush
    window.addEventListener('beforeunload', flushOutbox);

  } catch (error) {
    console.error('Initialization error:', error);
    alert('Failed to initialize chat');
  }
}

// Load message history
async function loadMessageHistory() {
  try {
    const response = await fetch('/api/v1/messages', {
      credentials: 'include',
    });
    const data = await response.json();

    if (data.success && data.details) {
      data.details.forEach(displayMessage);
    }
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}

// Display a message
function displayMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  
  const headerDiv = document.createElement('div');
  headerDiv.className = 'message-header';
  
  const senderSpan = document.createElement('span');
  senderSpan.className = 'message-sender';
  senderSpan.textContent = message.senderDisplayName;
  
  const timeSpan = document.createElement('span');
  const timestamp = new Date(message.serverReceivedAt || message.clientTimestamp);
  timeSpan.textContent = timestamp.toLocaleTimeString();
  
  headerDiv.appendChild(senderSpan);
  headerDiv.appendChild(timeSpan);
  
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'message-body';
  bodyDiv.textContent = message.body;
  
  messageDiv.appendChild(headerDiv);
  messageDiv.appendChild(bodyDiv);
  
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
async function sendMessage() {
  const body = messageInput.value.trim();
  if (!body) return;

  const messageId = generateUUID();
  const message = {
    messageId,
    type: 'text',
    body,
    clientTimestamp: new Date().toISOString(),
  };

  // Display immediately
  displayMessage({
    ...message,
    senderDisplayName: sessionInfo.displayName,
    senderUserId: sessionInfo.userId,
  });

  // Clear input
  messageInput.value = '';

  // Send via WebRTC to all peers
  broadcastViaDataChannel(message);

  // Add to outbox
  messageOutbox.push(message);

  // Save to backend
  try {
    await saveMessageToBackend(message);
    // Remove from outbox on success
    messageOutbox = messageOutbox.filter(m => m.messageId !== messageId);
  } catch (error) {
    console.error('Failed to save message:', error);
    // Keep in outbox for retry
  }
}

// Save message to backend
async function saveMessageToBackend(message) {
  const response = await fetch('/api/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error('Failed to save message');
  }
}

// Flush outbox (on page close)
function flushOutbox() {
  if (messageOutbox.length === 0) return;

  const blob = new Blob([JSON.stringify({ messages: messageOutbox })], {
    type: 'application/json',
  });

  navigator.sendBeacon('/api/v1/messages/batch', blob);
}

// Signaling polling
async function startSignalingPoll() {
  while (true) {
    try {
      const url = signalingCursor
        ? `/api/v1/signaling?cursor=${signalingCursor}`
        : '/api/v1/signaling';

      const response = await fetch(url, {
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success && data.details) {
        signalingCursor = data.details.cursor;
        
        for (const event of data.details.events) {
          await handleSignalingEvent(event);
        }
      }

      // Poll every 2 seconds
      await sleep(2000);
    } catch (error) {
      console.error('Signaling poll error:', error);
      await sleep(5000); // Retry after 5 seconds on error
    }
  }
}

// Handle signaling event
async function handleSignalingEvent(event) {
  const { type, fromUserId, data } = event;

  switch (type) {
    case 'peer-join':
      if (fromUserId !== sessionInfo.userId) {
        await createPeerConnection(fromUserId, true);
      }
      break;

    case 'offer':
      if (event.toUserId === sessionInfo.userId) {
        await handleOffer(fromUserId, data);
      }
      break;

    case 'answer':
      if (event.toUserId === sessionInfo.userId) {
        await handleAnswer(fromUserId, data);
      }
      break;

    case 'ice-candidate':
      if (event.toUserId === sessionInfo.userId) {
        await handleIceCandidate(fromUserId, data);
      }
      break;

    case 'peer-leave':
      closePeerConnection(fromUserId);
      break;
  }
}

// Create peer connection
async function createPeerConnection(peerId, initiator) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  });

  peerConnections.set(peerId, pc);

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingEvent('ice-candidate', peerId, event.candidate);
    }
  };

  // Handle connection state
  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${peerId}:`, pc.connectionState);
    updateConnectionStatus();
  };

  if (initiator) {
    // Create data channel
    const channel = pc.createDataChannel('chat', { ordered: true });
    setupDataChannel(peerId, channel);

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignalingEvent('offer', peerId, offer);
  } else {
    // Wait for data channel
    pc.ondatachannel = (event) => {
      setupDataChannel(peerId, event.channel);
    };
  }

  return pc;
}

// Handle offer
async function handleOffer(peerId, offer) {
  const pc = await createPeerConnection(peerId, false);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await sendSignalingEvent('answer', peerId, answer);
}

// Handle answer
async function handleAnswer(peerId, answer) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

// Handle ICE candidate
async function handleIceCandidate(peerId, candidate) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

// Set up data channel
function setupDataChannel(peerId, channel) {
  dataChannels.set(peerId, channel);

  channel.onopen = () => {
    console.log(`Data channel opened with ${peerId}`);
    updateConnectionStatus();
  };

  channel.onclose = () => {
    console.log(`Data channel closed with ${peerId}`);
    dataChannels.delete(peerId);
    updateConnectionStatus();
  };

  channel.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      displayMessage(message);
    } catch (error) {
      console.error('Failed to parse data channel message:', error);
    }
  };
}

// Close peer connection
function closePeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
  }

  const channel = dataChannels.get(peerId);
  if (channel) {
    channel.close();
    dataChannels.delete(peerId);
  }

  updateConnectionStatus();
}

// Broadcast message via data channels
function broadcastViaDataChannel(message) {
  const messageStr = JSON.stringify({
    ...message,
    senderDisplayName: sessionInfo.displayName,
    senderUserId: sessionInfo.userId,
    senderRole: sessionInfo.role,
  });

  for (const [peerId, channel] of dataChannels.entries()) {
    if (channel.readyState === 'open') {
      channel.send(messageStr);
    }
  }
}

// Send signaling event
async function sendSignalingEvent(type, toUserId, data) {
  await fetch('/api/v1/signaling', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      type,
      toUserId,
      data,
    }),
  });
}

// Update connection status
function updateConnectionStatus() {
  const hasConnectedPeers = Array.from(dataChannels.values()).some(
    (ch) => ch.readyState === 'open'
  );

  if (hasConnectedPeers) {
    statusSpan.textContent = 'Connected';
    statusSpan.className = 'status-connected';
  } else {
    statusSpan.textContent = 'Disconnected';
    statusSpan.className = 'status-disconnected';
  }
}

// Utility functions
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the application
init();
