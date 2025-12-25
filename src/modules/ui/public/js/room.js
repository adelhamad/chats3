/* eslint-disable no-undef */
// Room WebRTC client
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get("sessionId");

let sessionInfo = null;
let peerConnections = new Map(); // userId -> RTCPeerConnection
let dataChannels = new Map(); // userId -> RTCDataChannel
let messageOutbox = [];
let localStream = null; // Camera + Mic
let screenStream = null; // Screen share stream
let isScreenSharing = false;
let selectedFile = null;

const messagesDiv = document.getElementById("chatMessages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const attachButton = document.getElementById("attachButton");

// WebRTC Controls
const callButton = document.getElementById("callButton");
const audioBtn = document.getElementById("audioBtn");
const videoBtn = document.getElementById("videoBtn");
const screenBtn = document.getElementById("screenBtn");
const endCallButton = document.getElementById("endCallButton");

const recordButton = document.getElementById("recordButton");
const stopRecordButton = document.getElementById("stopRecordButton");
const videoContainer = document.getElementById("videoContainer");
const localVideo = document.getElementById("localVideo");
const remoteVideosDiv = document.getElementById("remoteVideos");
const fileInput = document.getElementById("fileInput");
const statusSpan = document.getElementById("connectionStatus");
const userNameSpan = document.getElementById("userName");
const previewContainer = document.getElementById("previewContainer");
const leaveButton = document.getElementById("leaveButton");

// API Fetch helper to handle session isolation
async function apiFetch(url, options = {}) {
  if (sessionId) {
    options.headers = {
      ...options.headers,
      "x-session-id": sessionId,
    };
  }
  return fetch(url, options);
}

// Initialize
async function init() {
  try {
    // Get session info
    const sessionResponse = await apiFetch("/api/v1/session");
    const sessionData = await sessionResponse.json();

    if (!sessionData.success) {
      alert("No valid session. Please join again.");
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
      return;
    }

    sessionInfo = sessionData.details;

    // Verify session matches current conversation
    if (sessionInfo.conversationId !== window.CONVERSATION_ID) {
      console.warn("Session conversation mismatch. Redirecting to join.");
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
      return;
    }

    userNameSpan.textContent = sessionInfo.displayName;

    // Handle embedded mode UI
    const isEmbedded = window.self !== window.top;
    if (isEmbedded) {
      callButton.style.display = "none";
      recordButton.style.display = "none";
      leaveButton.style.display = "none";
    }

    // Load message history
    await loadMessageHistory();
    scrollToBottom();

    // Start signaling SSE
    setupSignalingSSE();

    // Announce peer join
    await sendSignalingEvent("peer-join", undefined, {
      userId: sessionInfo.userId,
      displayName: sessionInfo.displayName,
    });

    // Set up send button
    sendButton.addEventListener("click", sendMessage);
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    messageInput.addEventListener("input", () => {
      messageInput.style.height = "auto";
      messageInput.style.height = messageInput.scrollHeight + "px";
    });

    // Set up attach button
    attachButton.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", handleFileSelect);

    // Set up call buttons
    callButton.addEventListener("click", startCall);
    audioBtn.addEventListener("click", toggleAudio);
    videoBtn.addEventListener("click", toggleVideo);
    screenBtn.addEventListener("click", toggleScreenShare);
    endCallButton.addEventListener("click", endCall);

    // Set up recording buttons
    recordButton.addEventListener("click", startRecording);
    stopRecordButton.addEventListener("click", stopRecording);

    // Set up leave button
    leaveButton.addEventListener("click", leaveConversation);

    // Set up beforeunload flush and leave
    window.addEventListener("beforeunload", handleUnload);

    // Handle paste events for images
    document.addEventListener("paste", handlePaste);
  } catch (error) {
    console.error("Initialization error:", error);
    alert("Failed to initialize chat");
  }
}

// Leave conversation
async function leaveConversation() {
  if (confirm("Are you sure you want to leave the conversation?")) {
    try {
      await apiFetch("/api/v1/leave", {
        method: "POST",
      });

      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
    } catch (error) {
      console.error("Error leaving conversation:", error);
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
    }
  }
}

// Handle unload (flush outbox and leave)
function handleUnload() {
  flushOutbox();
  // Send leave request via beacon
  // Note: Beacon doesn't support custom headers easily, but we still have the cookie as fallback
  // If we rely purely on headers, beacon might fail for auth.
  // However, for "leave on tab close", it's best effort.
  navigator.sendBeacon("/api/v1/leave");
}

// Scroll to bottom
function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Handle paste
function handlePaste(event) {
  const items = (event.clipboardData || event.originalEvent.clipboardData)
    .items;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      handleFileSelect({ target: { files: [file] } });
      event.preventDefault();
      return;
    }
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

    // Update UI
    callButton.style.display = "none";
    audioBtn.style.display = "inline-block";
    videoBtn.style.display = "inline-block";
    screenBtn.style.display = "inline-block";
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

// Toggle Audio
function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      audioBtn.textContent = audioTrack.enabled ? "🎤" : "🎤🚫";
      audioBtn.style.backgroundColor = audioTrack.enabled
        ? "#34495e"
        : "#95a5a6";
    }
  }
}

// Toggle Video
function toggleVideo() {
  if (isScreenSharing) {
    stopScreenShare();
    return;
  }

  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      videoBtn.textContent = videoTrack.enabled ? "📷" : "📷🚫";
      videoBtn.style.backgroundColor = videoTrack.enabled
        ? "#34495e"
        : "#95a5a6";
    }
  }
}

// Toggle Screen Share
async function toggleScreenShare() {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const screenTrack = screenStream.getVideoTracks()[0];

    // Handle user stopping via browser UI
    screenTrack.onended = () => {
      stopScreenShare();
    };

    // Replace track in all peer connections
    for (const pc of peerConnections.values()) {
      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(screenTrack);
      }
    }

    // Update local preview
    localVideo.srcObject = screenStream;

    isScreenSharing = true;
    screenBtn.style.backgroundColor = "#2ecc71"; // Green for active
  } catch (error) {
    console.error("Error starting screen share:", error);
  }
}

function stopScreenShare() {
  if (!isScreenSharing) {
    return;
  }

  // Stop screen stream tracks
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  // Revert to camera track
  if (localStream) {
    const cameraTrack = localStream.getVideoTracks()[0];

    // Replace track in all peer connections
    for (const pc of peerConnections.values()) {
      const sender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(cameraTrack);
      }
    }

    // Update local preview
    localVideo.srcObject = localStream;
  }

  isScreenSharing = false;
  screenBtn.style.backgroundColor = "#34495e"; // Reset color
}

// End Video Call
function endCall() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  localVideo.srcObject = null;
  videoContainer.style.display = "none";

  callButton.style.display = "inline-block";
  audioBtn.style.display = "none";
  videoBtn.style.display = "none";
  screenBtn.style.display = "none";
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

// Handle file selection
function handleFileSelect(event) {
  const file = event.target.files ? event.target.files[0] : null;
  if (!file) {
    return;
  }

  selectedFile = file;
  if (fileInput) {
    fileInput.value = "";
  } // Reset input so same file can be selected again if needed

  // Show preview
  previewContainer.innerHTML = "";
  previewContainer.style.display = "flex";

  const previewItem = document.createElement("div");
  previewItem.className = "preview-item";

  if (file.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      // URL.revokeObjectURL(img.src); // Keep it for now, revoking might break preview if element is moved
    };
    img.onerror = () => {
      img.style.display = "none";
      const errorText = document.createElement("div");
      errorText.textContent = "Image Error";
      errorText.style.fontSize = "10px";
      errorText.style.color = "red";
      previewItem.appendChild(errorText);
    };
    previewItem.appendChild(img);
  } else {
    const div = document.createElement("div");
    div.textContent = "File: " + file.name;
    div.style.padding = "10px";
    div.style.fontSize = "12px";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.height = "100%";
    previewItem.appendChild(div);
  }

  const removeBtn = document.createElement("div");
  removeBtn.className = "preview-remove";
  removeBtn.textContent = "✕";
  removeBtn.onclick = () => {
    selectedFile = null;
    previewContainer.innerHTML = "";
    previewContainer.style.display = "none";
  };

  previewItem.appendChild(removeBtn);
  previewContainer.appendChild(previewItem);
}

// Upload file
async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch("/api/v1/attachments", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.message || "Upload failed");
  }

  return data.details;
}

// Load message history
async function loadMessageHistory() {
  try {
    const response = await apiFetch("/api/v1/messages");
    const data = await response.json();

    if (data.success && data.details) {
      data.details.forEach(displayMessage);
    }
  } catch (error) {
    console.error("Failed to load history:", error);
  }
}

function getAvatar(name) {
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .substring(0, 2)
    : "?";
  const div = document.createElement("div");
  div.className = "message-avatar";
  div.textContent = initials;
  // Random background color based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase();
  div.style.backgroundColor = "#" + "00000".substring(0, 6 - c.length) + c;
  return div;
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

  // Check if message is own (by userId OR displayName for better UX across sessions)
  const isOwn =
    message.senderUserId === sessionInfo.userId ||
    (message.senderDisplayName &&
      message.senderDisplayName === sessionInfo.displayName);

  const isSystem = message.type === "system";

  const rowDiv = document.createElement("div");
  let rowClass = "message-row";
  if (isSystem) {
    rowClass += " system";
  } else if (isOwn) {
    rowClass += " own";
  } else {
    rowClass += " other";
  }
  rowDiv.className = rowClass;

  if (!isOwn && !isSystem) {
    rowDiv.appendChild(getAvatar(message.senderDisplayName || "User"));
  }

  const messageDiv = document.createElement("div");
  let msgClass = "message";
  if (isSystem) {
    msgClass += " system";
  } else if (isOwn) {
    msgClass += " own";
  } else {
    msgClass += " other";
  }
  messageDiv.className = msgClass;

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
  timeSpan.textContent = timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  headerDiv.appendChild(senderSpan);
  headerDiv.appendChild(timeSpan);

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "message-body";

  renderMessageBody(message, bodyDiv);

  messageDiv.appendChild(headerDiv);
  messageDiv.appendChild(bodyDiv);

  rowDiv.appendChild(messageDiv);

  messagesDiv.appendChild(rowDiv);
  scrollToBottom();
}

function renderMessageBody(message, bodyDiv) {
  if (message.type === "file") {
    if (message.mimetype && message.mimetype.startsWith("image/")) {
      renderImageAttachment(message, bodyDiv);
    } else {
      renderFileAttachment(message, bodyDiv);
    }
  } else {
    bodyDiv.textContent = message.body;
  }
}

function renderImageAttachment(message, container) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "5px";

  const img = document.createElement("img");
  img.src = message.url;
  img.style.maxWidth = "200px";
  img.style.maxHeight = "200px";
  img.style.borderRadius = "8px";
  img.style.cursor = "pointer";
  img.style.objectFit = "cover";
  img.onclick = () => window.open(message.url, "_blank");
  img.onload = scrollToBottom;

  const downloadLink = document.createElement("a");
  downloadLink.href = message.url;
  downloadLink.download = message.filename || "image";
  downloadLink.target = "_blank";
  downloadLink.textContent = "⬇ Download";
  downloadLink.style.fontSize = "12px";
  downloadLink.style.color = "#5682a3";
  downloadLink.style.textDecoration = "none";
  downloadLink.style.marginTop = "4px";

  wrapper.appendChild(img);
  wrapper.appendChild(downloadLink);
  container.appendChild(wrapper);
}

function renderFileAttachment(message, container) {
  const link = document.createElement("a");
  let safeUrl = "#";
  try {
    if (message.url) {
      const url = new URL(message.url, window.location.origin);
      if (["http:", "https:"].includes(url.protocol)) {
        safeUrl = message.url;
      }
    }
  } catch (error) {
    console.error("Invalid URL:", message.url, error);
  }

  link.href = safeUrl;
  link.textContent = "📎 " + (message.filename || message.body);
  link.target = "_blank";
  link.download = message.filename || "download";
  link.style.color = "#3498db";
  link.style.textDecoration = "none";
  container.appendChild(link);
}

// Send message
async function sendMessage() {
  const body = messageInput.value.trim();

  if (!body && !selectedFile) {
    return;
  }

  const messageId = generateUUID();
  let message = {
    messageId,
    clientTimestamp: new Date().toISOString(),
    senderDisplayName: sessionInfo.displayName,
    senderUserId: sessionInfo.userId,
  };

  try {
    if (selectedFile) {
      const attachment = await uploadFile(selectedFile);
      message = {
        ...message,
        type: "file",
        body: body || `[File] ${attachment.originalFilename}`,
        attachmentId: attachment.attachmentId,
        filename: attachment.originalFilename,
        mimetype: attachment.mimeType,
        url: `/api/v1/attachments/${attachment.attachmentId}?download=true`,
      };

      // Clear selection
      selectedFile = null;
      previewContainer.innerHTML = "";
      previewContainer.style.display = "none";
    } else {
      message = {
        ...message,
        type: "text",
        body,
      };
    }

    // Display immediately
    displayMessage(message);

    // Clear input
    messageInput.value = "";
    messageInput.style.height = "auto";

    // Send via WebRTC to all peers
    broadcastViaDataChannel(message);

    // Add to outbox
    messageOutbox.push(message);

    // Save to backend
    await saveMessageToBackend(message);
    // Remove from outbox on success
    messageOutbox = messageOutbox.filter((m) => m.messageId !== messageId);
  } catch (error) {
    console.error("Failed to send message:", error);
    alert("Failed to send message: " + error.message);
  }
}

// Save message to backend
async function saveMessageToBackend(message) {
  const response = await apiFetch("/api/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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

  const url = sessionId
    ? `/api/v1/messages/batch?sessionId=${sessionId}`
    : "/api/v1/messages/batch";
  navigator.sendBeacon(url, blob);
}

// Signaling SSE
function setupSignalingSSE() {
  console.log("Setting up SSE connection...");

  const url = sessionId
    ? `/api/v1/signaling?sessionId=${sessionId}`
    : "/api/v1/signaling";

  const eventSource = new EventSource(url);

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
  await apiFetch("/api/v1/signaling", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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
    statusSpan.textContent = "🟢";
    statusSpan.className = "status-connected";
    statusSpan.title = "Connected (P2P)";
  } else if (isSSEConnected) {
    statusSpan.textContent = "🟡";
    statusSpan.className = "status-connected";
    statusSpan.style.color = "#e67e22";
    statusSpan.title = "Connected (Server)";
  } else {
    statusSpan.textContent = "🔴";
    statusSpan.className = "status-disconnected";
    statusSpan.style.color = "";
    statusSpan.title = "Disconnected";
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
