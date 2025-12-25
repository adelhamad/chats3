/* eslint-disable no-undef */
// Room WebRTC client
let sessionInfo = null;
let peerConnections = new Map(); // userId -> RTCPeerConnection
let dataChannels = new Map(); // userId -> RTCDataChannel
let messageOutbox = [];
let localStream = null;

const messagesDiv = document.getElementById("chatMessages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const attachButton = document.getElementById("attachButton");
const callButton = document.getElementById("callButton");
const endCallButton = document.getElementById("endCallButton");
const recordButton = document.getElementById("recordButton");
const stopRecordButton = document.getElementById("stopRecordButton");
const videoContainer = document.getElementById("videoContainer");
const localVideo = document.getElementById("localVideo");
const remoteVideosDiv = document.getElementById("remoteVideos");
const fileInput = document.getElementById("fileInput");
const statusSpan = document.getElementById("connectionStatus");
const userNameSpan = document.getElementById("userName");

// Initialize
async function init() {
  try {
    // Get session info
    const sessionResponse = await fetch("/api/v1/session", {
      credentials: "include",
    });
    const sessionData = await sessionResponse.json();

    if (!sessionData.success) {
      alert("No valid session. Please join again.");
      window.location.href = "/join";
      return;
    }

    sessionInfo = sessionData.details;
    userNameSpan.textContent = sessionInfo.displayName;

    // Load message history
    await loadMessageHistory();

    // Start signaling SSE
    setupSignalingSSE();

    // Announce peer join
    await sendSignalingEvent("peer-join", undefined, {
      userId: sessionInfo.userId,
      displayName: sessionInfo.displayName,
    });

    // Set up send button
    sendButton.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendMessage();
      }
    });

    // Set up attach button
    attachButton.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", handleFileUpload);

    // Set up call buttons
    callButton.addEventListener("click", startCall);
    endCallButton.addEventListener("click", endCall);

    // Set up recording buttons
    recordButton.addEventListener("click", startRecording);
    stopRecordButton.addEventListener("click", stopRecording);

    // Set up beforeunload flush
    window.addEventListener("beforeunload", flushOutbox);
  } catch (error) {
    console.error("Initialization error:", error);
    alert("Failed to initialize chat");
  }
}

// Start Video Call
async function startCall() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;
    videoContainer.style.display = "block";
    callButton.style.display = "none";
    endCallButton.style.display = "inline-block";

    // Add tracks to all existing peer connections
    for (const [peerId, pc] of peerConnections.entries()) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // Renegotiate
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignalingEvent("offer", peerId, offer);
    }
  } catch (error) {
    console.error("Error starting call:", error);
    alert("Could not start call: " + error.message);
  }
}

// End Video Call
function endCall() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  localVideo.srcObject = null;
  videoContainer.style.display = "none";
  callButton.style.display = "inline-block";
  endCallButton.style.display = "none";

  // Remove tracks from peer connections (optional, but good practice)
  // In a simple reload-based app, this might not be strictly necessary if we just stop sending.
  // But to be clean, we could renegotiate. For this experiment, stopping tracks is enough.
  // The remote side will see a frozen or black screen.

  // Ideally we should send a "stop-video" signal or renegotiate removing tracks.
  // For simplicity:
  window.location.reload(); // Easiest way to reset state for "experiment"
}

// Recording Logic
let mediaRecorder;
let recordedChunks = [];

async function startRecording() {
  try {
    // Use Screen Recording API to capture the tab (video + audio)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: "screen" },
      audio: true,
    });

    mediaRecorder = new MediaRecorder(stream);
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `recording-${new Date().toISOString()}.webm`;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 100);

      // Reset UI
      recordButton.style.display = "inline-block";
      stopRecordButton.style.display = "none";
    };

    mediaRecorder.start();

    // Update UI
    recordButton.style.display = "none";
    stopRecordButton.style.display = "inline-block";

    // Handle user stopping via browser UI (e.g. "Stop sharing" bar)
    stream.getVideoTracks()[0].onended = () => {
      stopRecording();
    };
  } catch (err) {
    console.error("Error starting recording:", err);
    alert("Could not start recording: " + err.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
}

// Handle file upload
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  // Reset input
  fileInput.value = "";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("/api/v1/attachments", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.message || "Upload failed");
    }

    const attachment = data.details;

    // Send message with attachment
    const messageId = generateUUID();
    const message = {
      messageId,
      type: "file",
      body: `[File] ${attachment.originalFilename}`,
      clientTimestamp: new Date().toISOString(),
      attachmentId: attachment.attachmentId,
      filename: attachment.originalFilename,
      mimetype: attachment.mimeType,
      url: `/api/v1/attachments/${attachment.attachmentId}?download=true`,
    };

    // Display immediately
    displayMessage({
      ...message,
      senderDisplayName: sessionInfo.displayName,
      senderUserId: sessionInfo.userId,
    });

    // Send via WebRTC
    broadcastViaDataChannel(message);

    // Save to backend (as a message)
    await saveMessageToBackend(message);
  } catch (error) {
    console.error("Upload error:", error);
    alert("Failed to upload file: " + error.message);
  }
}

// Load message history
async function loadMessageHistory() {
  try {
    const response = await fetch("/api/v1/messages", {
      credentials: "include",
    });
    const data = await response.json();

    if (data.success && data.details) {
      data.details.forEach(displayMessage);
    }
  } catch (error) {
    console.error("Failed to load history:", error);
  }
}

// Display a message
function displayMessage(message) {
  // Avoid duplicates
  if (
    message.messageId &&
    document.querySelector(`[data-message-id="${message.messageId}"]`)
  ) {
    return;
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = "message";
  if (message.messageId) {
    messageDiv.setAttribute("data-message-id", message.messageId);
  }

  const headerDiv = document.createElement("div");
  headerDiv.className = "message-header";

  const senderSpan = document.createElement("span");
  senderSpan.className = "message-sender";
  senderSpan.textContent = message.senderDisplayName;

  const timeSpan = document.createElement("span");
  const timestamp = new Date(
    message.serverReceivedAt || message.clientTimestamp,
  );
  timeSpan.textContent = timestamp.toLocaleTimeString();

  headerDiv.appendChild(senderSpan);
  headerDiv.appendChild(timeSpan);

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "message-body";

  if (message.type === "file") {
    const link = document.createElement("a");

    // Validate URL protocol to prevent XSS
    let safeUrl = "#";
    try {
      if (message.url) {
        const url = new URL(message.url, window.location.origin);
        if (["http:", "https:"].includes(url.protocol)) {
          safeUrl = message.url;
        }
      }
    } catch (e) {
      console.error("Invalid URL:", message.url);
    }

    link.href = safeUrl;
    link.textContent = message.filename || message.body;
    link.target = "_blank";
    link.download = message.filename || "download";
    bodyDiv.appendChild(link);
  } else {
    bodyDiv.textContent = message.body;
  }

  messageDiv.appendChild(headerDiv);
  messageDiv.appendChild(bodyDiv);

  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
async function sendMessage() {
  const body = messageInput.value.trim();
  if (!body) {
    return;
  }

  const messageId = generateUUID();
  const message = {
    messageId,
    type: "text",
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
  messageInput.value = "";

  // Send via WebRTC to all peers
  broadcastViaDataChannel(message);

  // Add to outbox
  messageOutbox.push(message);

  // Save to backend
  try {
    await saveMessageToBackend(message);
    // Remove from outbox on success
    messageOutbox = messageOutbox.filter((m) => m.messageId !== messageId);
  } catch (error) {
    console.error("Failed to save message:", error);
    // Keep in outbox for retry
  }
}

// Save message to backend
async function saveMessageToBackend(message) {
  const response = await fetch("/api/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error("Failed to save message");
  }
}

// Flush outbox (on page close)
function flushOutbox() {
  if (messageOutbox.length === 0) {
    return;
  }

  const blob = new Blob([JSON.stringify({ messages: messageOutbox })], {
    type: "application/json",
  });

  navigator.sendBeacon("/api/v1/messages/batch", blob);
}

// Signaling SSE
function setupSignalingSSE() {
  console.log("Setting up SSE connection...");
  const eventSource = new EventSource("/api/v1/signaling", {
    withCredentials: true,
  });

  eventSource.onopen = () => {
    console.log("SSE connection opened");
    updateConnectionStatus();
  };

  eventSource.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      // console.log("SSE received:", data.type);

      if (data.type === "system" && data.data === "connected") {
        console.log("SSE system connected");
        return;
      }

      await handleSignalingEvent(data);
    } catch (error) {
      console.error("Failed to parse signaling event:", error);
    }
  };

  eventSource.onerror = (error) => {
    console.error("SSE error:", error);
    // EventSource automatically retries, but we can handle specific errors if needed
    if (eventSource.readyState === EventSource.CLOSED) {
      updateConnectionStatus();
    }
  };

  // Store reference to close later if needed
  window.signalingEventSource = eventSource;
}

// Handle signaling event
async function handleSignalingEvent(event) {
  const { type, fromUserId, data } = event;
  console.log(`Handling signaling event: ${type} from ${fromUserId}`);

  switch (type) {
    case "peer-join":
      if (fromUserId !== sessionInfo.userId) {
        console.log(`Peer joined: ${fromUserId}. Initiating connection...`);
        await createPeerConnection(fromUserId, true);
      } else {
        console.warn(
          "Ignoring peer-join from self. To test peer connection, use a different browser or Incognito mode.",
        );
      }
      break;

    case "offer":
      if (event.toUserId === sessionInfo.userId) {
        console.log(`Received offer from ${fromUserId}`);
        await handleOffer(fromUserId, data);
      }
      break;

    case "answer":
      if (event.toUserId === sessionInfo.userId) {
        console.log(`Received answer from ${fromUserId}`);
        await handleAnswer(fromUserId, data);
      }
      break;

    case "ice-candidate":
      if (event.toUserId === sessionInfo.userId) {
        await handleIceCandidate(fromUserId, data);
      }
      break;

    case "peer-leave":
      closePeerConnection(fromUserId);
      break;

    case "new-message":
      // Handle message received via server (fallback/sync)
      if (data.messageId) {
        // Check if we already have this message (e.g. sent by us or received via WebRTC)
        // We need a way to check duplicates.
        // For now, let's just try to display it. displayMessage appends.
        // We should probably check if the message ID is already in the DOM or memory.
        const existingMsg = document.querySelector(
          `[data-message-id="${data.messageId}"]`,
        );
        if (!existingMsg) {
          displayMessage(data);
        }
      }
      break;
  }
}

// Create peer connection
async function createPeerConnection(peerId, initiator) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  peerConnections.set(peerId, pc);

  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingEvent("ice-candidate", peerId, event.candidate);
    }
  };

  // Handle connection state
  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${peerId}:`, pc.connectionState);
    updateConnectionStatus();
  };

  // Handle remote tracks (Video/Audio)
  pc.ontrack = (event) => {
    console.log(`Received remote track from ${peerId}`, event.streams);
    const stream = event.streams[0];
    if (!stream) {
      return;
    }

    let videoEl = document.getElementById(`remote-video-${peerId}`);
    if (!videoEl) {
      const wrapper = document.createElement("div");
      wrapper.className = "video-wrapper";
      wrapper.style.position = "relative";
      wrapper.style.minWidth = "200px";

      videoEl = document.createElement("video");
      videoEl.id = `remote-video-${peerId}`;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.style.width = "200px";
      videoEl.style.height = "150px";
      videoEl.style.background = "#000";
      videoEl.style.borderRadius = "8px";
      videoEl.style.objectFit = "cover";

      const label = document.createElement("span");
      label.textContent = `User ${peerId.substr(0, 4)}`; // Simple label
      label.style.position = "absolute";
      label.style.bottom = "5px";
      label.style.left = "5px";
      label.style.color = "white";
      label.style.fontSize = "12px";
      label.style.background = "rgba(0,0,0,0.5)";
      label.style.padding = "2px 5px";
      label.style.borderRadius = "4px";

      wrapper.appendChild(videoEl);
      wrapper.appendChild(label);
      remoteVideosDiv.appendChild(wrapper);

      // Show container if hidden
      videoContainer.style.display = "block";
    }
    videoEl.srcObject = stream;
  };

  // Add local tracks if call is active
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  if (initiator) {
    // Create data channel
    const channel = pc.createDataChannel("chat", { ordered: true });
    setupDataChannel(peerId, channel);

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignalingEvent("offer", peerId, offer);
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
  await sendSignalingEvent("answer", peerId, answer);
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
      console.error("Failed to parse data channel message:", error);
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

  // Remove remote video
  const videoEl = document.getElementById(`remote-video-${peerId}`);
  if (videoEl) {
    videoEl.parentElement.remove();
  }

  // Hide container if no videos
  if (remoteVideosDiv.children.length === 0 && !localStream) {
    videoContainer.style.display = "none";
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

  // eslint-disable-next-line sonarjs/no-unused-vars, no-unused-vars, sonarjs/no-dead-store
  for (const [peerId, channel] of dataChannels.entries()) {
    if (channel.readyState === "open") {
      channel.send(messageStr);
    }
  }
}

// Send signaling event
async function sendSignalingEvent(type, toUserId, data) {
  await fetch("/api/v1/signaling", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
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
    (ch) => ch.readyState === "open",
  );

  const isSSEConnected =
    window.signalingEventSource &&
    window.signalingEventSource.readyState === EventSource.OPEN;

  if (hasConnectedPeers) {
    statusSpan.textContent = "Connected (P2P)";
    statusSpan.className = "status-connected";
    statusSpan.title = "Direct WebRTC connection established";
  } else if (isSSEConnected) {
    statusSpan.textContent = "Connected (Server)";
    statusSpan.className = "status-connected"; // Use same green color or maybe yellow?
    statusSpan.style.color = "#e67e22"; // Orange to indicate fallback
    statusSpan.title = "Connected via Server Relay (WebRTC connecting...)";
  } else {
    statusSpan.textContent = "Disconnected";
    statusSpan.className = "status-disconnected";
    statusSpan.style.color = ""; // Reset
  }
}

// Utility functions
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Start the application
init();
