/* eslint-disable no-undef */
// Signaling and WebRTC peer connections

import { endCall } from "./call.js";
import {
  displayMessage,
  updateLastSeen,
  updateAvatarStatus,
  updateReactionDisplay,
} from "./messages.js";
import {
  $,
  sessionInfo,
  peerConnections,
  dataChannels,
  localStream,
  messageReactions,
  apiFetch,
} from "./state.js";

// Track peer displayNames for video labels
const peerDisplayNames = new Map(); // peerId -> displayName

// Queue ICE candidates until remote description is set
const pendingIceCandidates = new Map(); // peerId -> candidate[]

// Track known participants from room-state for reconnection
let knownParticipants = new Map(); // peerId -> { displayName }

// Heartbeat interval for checking stale connections
let connectionHeartbeat = null;

// Send signaling event
export async function sendSignalingEvent(type, toUserId, data) {
  await apiFetch("/api/v1/signaling", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, toUserId, data }),
  });
}

// Update connection status UI
export function updateConnectionStatus() {
  const hasConnectedPeers = Array.from(dataChannels.values()).some(
    (ch) => ch.readyState === "open",
  );
  const isSSEConnected =
    window.signalingEventSource?.readyState === EventSource.OPEN;

  // Use knownParticipants for accurate count (includes self)
  const onlineCount = knownParticipants.size;
  const peersText = onlineCount > 1 ? `${onlineCount} in room` : "";

  // Update avatar status for connected peers
  peerConnections.forEach((pc, userId) => {
    updateAvatarStatus(userId, true);
  });

  if (hasConnectedPeers) {
    $.statusSpan.innerHTML = peersText
      ? `<span class="pulse-dot"></span>${peersText}`
      : "";
    $.statusSpan.className = "status-connected";
    $.statusSpan.title = "Connected (P2P)";
  } else if (isSSEConnected) {
    $.statusSpan.innerHTML = peersText
      ? `<span class="pulse-dot yellow"></span>${peersText}`
      : "Waiting...";
    $.statusSpan.className = "status-connected";
    $.statusSpan.style.color = "";
    $.statusSpan.title = "Connected (Server) - Waiting for peers";
  } else {
    $.statusSpan.innerHTML = "Offline";
    $.statusSpan.className = "status-disconnected";
    $.statusSpan.style.color = "";
    $.statusSpan.title = "Disconnected";
  }
}

// Setup data channel
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
      if (message.type === "receipt") {
        handleReadReceipt(message);
      } else if (message.type === "typing") {
        handleTypingIndicator(peerId, message);
      } else if (message.type === "reaction") {
        handleReaction(message);
      } else {
        displayMessage(message);
        if (message.messageId) {
          sendReadReceipt(peerId, message.messageId, "delivered");
          if (document.hasFocus()) {
            sendReadReceipt(peerId, message.messageId, "read");
          } else {
            const onFocus = () => {
              sendReadReceipt(peerId, message.messageId, "read");
              window.removeEventListener("focus", onFocus);
            };
            window.addEventListener("focus", onFocus);
          }
        }
      }
    } catch (error) {
      console.error("Failed to parse data channel message:", error);
    }
  };
}

function sendReadReceipt(peerId, messageId, status) {
  const channel = dataChannels.get(peerId);
  if (channel?.readyState === "open") {
    channel.send(JSON.stringify({ type: "receipt", messageId, status }));
  }
}

function handleReadReceipt(receipt) {
  const statusSpan = document.getElementById(`status-${receipt.messageId}`);
  if (statusSpan) {
    statusSpan.textContent = "✓✓";
    if (receipt.status === "read") {
      statusSpan.classList.add("read");
      statusSpan.title = "Read";
    } else {
      statusSpan.title = "Delivered";
    }
  }
}

// Typing indicator
let typingTimeout = null;
const typingPeers = new Map(); // peerId -> { displayName, timeout }

export function broadcastTyping(isTyping) {
  if (isTyping) {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    typingTimeout = setTimeout(() => {
      broadcastViaDataChannel({ type: "typing", isTyping: false });
      typingTimeout = null;
    }, 2000);
    broadcastViaDataChannel({
      type: "typing",
      isTyping: true,
      displayName: sessionInfo.displayName,
    });
  }
}

function handleTypingIndicator(peerId, data) {
  const typingDiv = document.getElementById("typingIndicator");
  if (!typingDiv) {
    return;
  }

  if (data.isTyping) {
    const existing = typingPeers.get(peerId);
    if (existing) {
      clearTimeout(existing.timeout);
    }
    const timeout = setTimeout(() => {
      typingPeers.delete(peerId);
      updateTypingDisplay();
    }, 3000);
    typingPeers.set(peerId, {
      displayName: data.displayName || "Someone",
      timeout,
    });
  } else {
    const existing = typingPeers.get(peerId);
    if (existing) {
      clearTimeout(existing.timeout);
    }
    typingPeers.delete(peerId);
  }
  updateTypingDisplay();
}

function updateTypingDisplay() {
  const typingDiv = document.getElementById("typingIndicator");
  if (!typingDiv) {
    return;
  }
  const names = Array.from(typingPeers.values()).map((p) => p.displayName);
  let text = "";
  if (names.length === 1) {
    text = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing...`;
  } else if (names.length > 2) {
    text = `${names[0]} and ${names.length - 1} others are typing...`;
  }
  typingDiv.textContent = text;
  typingDiv.style.display = names.length > 0 ? "block" : "none";
}

// Reactions - one reaction per user per message
export function sendReaction(messageId, emoji) {
  const userId = sessionInfo.userId;
  if (!messageReactions.has(messageId)) {
    messageReactions.set(messageId, new Map());
  }
  const reactions = messageReactions.get(messageId);

  // Find and remove user's existing reaction (if any)
  let oldEmoji = null;
  for (const [e, users] of reactions.entries()) {
    if (users.has(userId)) {
      oldEmoji = e;
      users.delete(userId);
      if (users.size === 0) {
        reactions.delete(e);
      }
      break;
    }
  }

  // If clicking same emoji, just remove (toggle off)
  // If different emoji, add new one
  let added = false;
  if (oldEmoji !== emoji) {
    if (!reactions.has(emoji)) {
      reactions.set(emoji, new Set());
    }
    reactions.get(emoji).add(userId);
    added = true;
  }

  updateReactionDisplay(messageId);
  broadcastViaDataChannel({
    type: "reaction",
    messageId,
    emoji,
    userId,
    added,
    oldEmoji,
  });

  // Persist to server
  apiFetch("/api/v1/reactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, emoji, added }),
  }).catch((err) => console.error("Failed to save reaction:", err));
}

function handleReaction(data) {
  const { messageId, emoji, userId, added, oldEmoji } = data;
  if (!messageReactions.has(messageId)) {
    messageReactions.set(messageId, new Map());
  }
  const reactions = messageReactions.get(messageId);

  // Remove old emoji if user switched reactions
  if (oldEmoji && oldEmoji !== emoji) {
    const oldUsers = reactions.get(oldEmoji);
    if (oldUsers) {
      oldUsers.delete(userId);
      if (oldUsers.size === 0) {
        reactions.delete(oldEmoji);
      }
    }
  }

  // Handle current emoji
  if (!reactions.has(emoji)) {
    reactions.set(emoji, new Set());
  }
  const users = reactions.get(emoji);
  if (added) {
    users.add(userId);
  } else {
    users.delete(userId);
    if (users.size === 0) {
      reactions.delete(emoji);
    }
  }
  updateReactionDisplay(messageId);
}

// Create peer connection
export async function createPeerConnection(peerId, initiator) {
  // Check if we already have a healthy connection
  if (peerConnections.has(peerId)) {
    const existingPc = peerConnections.get(peerId);
    const state = existingPc.connectionState;
    // If connection is still being established or is connected, reuse it
    if (state === "new" || state === "connecting" || state === "connected") {
      console.log(
        `Reusing existing connection with ${peerId} (state: ${state})`,
      );
      return existingPc;
    }
    // Otherwise close the stale connection
    console.log(`Closing stale connection with ${peerId} (state: ${state})`);
    closePeerConnection(peerId);
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  peerConnections.set(peerId, pc);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingEvent("ice-candidate", peerId, event.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${peerId}:`, pc.connectionState);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      closePeerConnection(peerId);
    } else if (pc.connectionState === "disconnected") {
      // Disconnected state can recover, wait 5s before cleaning up
      setTimeout(() => {
        if (pc.connectionState === "disconnected") {
          closePeerConnection(peerId);
        }
      }, 5000);
    }
    updateConnectionStatus();
  };

  pc.ontrack = (event) => {
    console.log(
      `Received remote track from ${peerId}:`,
      event.track.kind,
      event.streams,
    );
    const stream = event.streams[0];
    if (!stream) {
      console.warn(`No stream in ontrack event from ${peerId}`);
      return;
    }

    let videoEl = document.getElementById(`remote-video-${peerId}`);
    if (!videoEl) {
      const wrapper = document.createElement("div");
      wrapper.className = "video-wrapper";
      wrapper.id = `video-wrapper-${peerId}`;

      videoEl = document.createElement("video");
      videoEl.id = `remote-video-${peerId}`;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = false;

      const label = document.createElement("span");
      label.id = `remote-label-${peerId}`;
      label.className = "video-label";
      const displayName = peerDisplayNames.get(peerId) || "User";
      label.textContent = displayName;

      wrapper.appendChild(videoEl);
      wrapper.appendChild(label);
      $.remoteVideosDiv.appendChild(wrapper);
      $.videoContainer.style.display = "block";
    }

    // Always update the srcObject - this handles track updates
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }

    // Ensure video plays (some browsers require user interaction)
    videoEl.play().catch((err) => {
      console.warn(`Could not auto-play video from ${peerId}:`, err);
    });
  };

  // Handle renegotiation - when tracks are added/removed
  pc.onnegotiationneeded = async () => {
    console.log(`Negotiation needed with ${peerId}`);
    // Only the initiator (lower userId) should create offers during renegotiation
    if (sessionInfo.userId < peerId) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignalingEvent("offer", peerId, offer);
      } catch (err) {
        console.error(`Renegotiation failed with ${peerId}:`, err);
      }
    }
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  if (initiator) {
    const channel = pc.createDataChannel("chat", { ordered: true });
    setupDataChannel(peerId, channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignalingEvent("offer", peerId, offer);
  } else {
    pc.ondatachannel = (event) => setupDataChannel(peerId, event.channel);
  }

  return pc;
}

// Handle offer
async function handleOffer(peerId, offer) {
  let pc = peerConnections.get(peerId);

  // Handle glare: if we already sent an offer, use tiebreaker (lower ID wins as initiator)
  if (pc && pc.signalingState === "have-local-offer") {
    if (sessionInfo.userId < peerId) {
      // We win, ignore their offer - they should accept our offer
      console.log(`Glare with ${peerId}: we win, ignoring their offer`);
      return;
    }
    // They win, rollback our offer and accept theirs
    console.log(`Glare with ${peerId}: they win, rolling back`);
    await pc.setLocalDescription({ type: "rollback" });
  }

  // For renegotiation: if we have a stable connection, accept the offer
  // This allows track additions/removals to be negotiated
  if (pc && pc.signalingState === "stable") {
    console.log(`Renegotiation offer from ${peerId}, processing...`);
  }

  if (!pc) {
    pc = await createPeerConnection(peerId, false);
  } else if (
    pc.signalingState !== "stable" &&
    pc.signalingState !== "have-local-offer"
  ) {
    // Connection is in a weird state, recreate it
    console.log(
      `Recreating connection with ${peerId} due to bad state: ${pc.signalingState}`,
    );
    closePeerConnection(peerId);
    pc = await createPeerConnection(peerId, false);
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  // Process queued ICE candidates
  const queued = pendingIceCandidates.get(peerId) || [];
  pendingIceCandidates.delete(peerId);
  for (const candidate of queued) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await sendSignalingEvent("answer", peerId, answer);
}

// Handle answer
async function handleAnswer(peerId, answer) {
  const pc = peerConnections.get(peerId);
  if (!pc) {
    return;
  }

  // Only accept answer if we're expecting one
  if (pc.signalingState !== "have-local-offer") {
    console.log(
      `Ignoring answer from ${peerId}: wrong state ${pc.signalingState}`,
    );
    return;
  }

  await pc.setRemoteDescription(new RTCSessionDescription(answer));

  // Process queued ICE candidates
  const queued = pendingIceCandidates.get(peerId) || [];
  pendingIceCandidates.delete(peerId);
  for (const candidate of queued) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

// Handle ICE candidate
async function handleIceCandidate(peerId, candidate) {
  const pc = peerConnections.get(peerId);

  // Queue if no connection yet or remote description not set
  if (!pc || !pc.remoteDescription) {
    if (!pendingIceCandidates.has(peerId)) {
      pendingIceCandidates.set(peerId, []);
    }
    pendingIceCandidates.get(peerId).push(candidate);
    return;
  }

  await pc.addIceCandidate(new RTCIceCandidate(candidate));
}

// Close peer connection
export function closePeerConnection(peerId) {
  pendingIceCandidates.delete(peerId);

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

  const now = new Date().toISOString();
  updateLastSeen(peerId, now);
  updateAvatarStatus(peerId, false, now);

  peerDisplayNames.delete(peerId);

  const videoEl = document.getElementById(`remote-video-${peerId}`);
  if (videoEl) {
    // Stop any tracks on the video element
    if (videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach((track) => track.stop());
      videoEl.srcObject = null;
    }
    videoEl.parentElement.remove();
  }

  if ($.remoteVideosDiv.children.length === 0 && !localStream) {
    $.videoContainer.style.display = "none";
  }

  updateConnectionStatus();
}

// Broadcast via data channels
export function broadcastViaDataChannel(message) {
  const messageStr = JSON.stringify({
    ...message,
    senderDisplayName: sessionInfo.displayName,
    senderUserId: sessionInfo.userId,
    senderRole: sessionInfo.role,
  });

  for (const [, channel] of dataChannels.entries()) {
    if (channel.readyState === "open") {
      channel.send(messageStr);
    }
  }
}

// Check if a peer connection is healthy
function isPeerConnectionHealthy(peerId) {
  const pc = peerConnections.get(peerId);
  if (!pc) {
    return false;
  }

  const state = pc.connectionState;
  // Consider "new", "connecting", "connected" as healthy
  // "failed", "closed", "disconnected" need reconnection
  return state === "new" || state === "connecting" || state === "connected";
}

// Start heartbeat to check for stale connections
function startConnectionHeartbeat() {
  if (connectionHeartbeat) {
    clearInterval(connectionHeartbeat);
  }

  // Check every 5 seconds for peers that should be connected but aren't
  connectionHeartbeat = setInterval(async () => {
    // Only run if SSE is connected
    if (window.signalingEventSource?.readyState !== EventSource.OPEN) {
      return;
    }

    // Check each known participant
    for (const peerId of knownParticipants.keys()) {
      if (peerId === sessionInfo.userId) {
        continue;
      }

      const shouldInitiate = sessionInfo.userId < peerId;
      const hasHealthyConnection = isPeerConnectionHealthy(peerId);

      // If we should initiate and don't have a healthy connection, try to connect
      if (shouldInitiate && !hasHealthyConnection) {
        console.log(`Heartbeat: Reconnecting to ${peerId}`);
        // Clean up any stale connection first
        if (peerConnections.has(peerId)) {
          closePeerConnection(peerId);
        }
        await createPeerConnection(peerId, true);
      }
    }
  }, 5000);
}

function stopConnectionHeartbeat() {
  if (connectionHeartbeat) {
    clearInterval(connectionHeartbeat);
    connectionHeartbeat = null;
  }
}

// Handle peer-join event
async function handlePeerJoin(fromUserId, data) {
  if (fromUserId === sessionInfo.userId) {
    return;
  }

  // Store peer's displayName for video labels and known participants
  if (data?.displayName) {
    peerDisplayNames.set(fromUserId, data.displayName);
  }
  knownParticipants.set(fromUserId, { displayName: data?.displayName });

  // Clean up stale connection before deciding to initiate
  if (peerConnections.has(fromUserId) && !isPeerConnectionHealthy(fromUserId)) {
    console.log(`Peer ${fromUserId} has stale connection, cleaning up`);
    closePeerConnection(fromUserId);
  }

  // Only the peer with lower userId initiates to prevent glare
  const shouldInitiate = sessionInfo.userId < fromUserId;
  if (shouldInitiate && !peerConnections.has(fromUserId)) {
    console.log(`Peer joined: ${fromUserId}. We initiate.`);
    await createPeerConnection(fromUserId, true);
  } else if (!shouldInitiate) {
    console.log(`Peer joined: ${fromUserId}. Waiting for their offer.`);
  }
}

// Handle new-message event
function handleNewMessage(data) {
  if (
    data.messageId &&
    !document.querySelector(`[data-message-id="${data.messageId}"]`)
  ) {
    displayMessage(data);
  }
}

// Handle room-state event (initial participant list)
// This is called once when SSE connects, containing all current participants
async function handleRoomState(data) {
  const { participants } = data;
  if (!participants || !Array.isArray(participants)) {
    return;
  }

  console.log("Received room state:", participants);

  // Update known participants list (for heartbeat reconnection)
  knownParticipants.clear();
  for (const participant of participants) {
    knownParticipants.set(participant.userId, {
      displayName: participant.displayName,
    });
  }

  // Collect peers we need to connect to
  const peersToConnect = [];

  for (const participant of participants) {
    const { userId: peerId, displayName } = participant;

    if (peerId === sessionInfo.userId) {
      continue;
    }

    // Store display name
    if (displayName) {
      peerDisplayNames.set(peerId, displayName);
    }

    // Check if we need to initiate connection
    // Lower userId always initiates to prevent glare
    if (sessionInfo.userId < peerId && !isPeerConnectionHealthy(peerId)) {
      peersToConnect.push(peerId);
    }
  }

  // Connect to peers sequentially to avoid race conditions
  for (const peerId of peersToConnect) {
    console.log(`Room state: Initiating connection to ${peerId}`);
    await createPeerConnection(peerId, true);
  }

  // Start heartbeat to detect and fix stale connections
  startConnectionHeartbeat();

  // After processing room state, announce our presence to notify
  // higher-ID peers that we're ready for their offers
  // This is the ONLY place we send peer-join
  console.log("Sending peer-join after room-state");
  await sendSignalingEvent("peer-join", undefined, {
    userId: sessionInfo.userId,
    displayName: sessionInfo.displayName,
  });
}

// Handle signaling event
async function handleSignalingEvent(event) {
  const { type, fromUserId, data } = event;

  // Skip verbose logging for ice-candidate
  if (type !== "ice-candidate") {
    console.log(`Signaling: ${type} from ${fromUserId}`);
  }

  switch (type) {
    case "room-state":
      await handleRoomState(data);
      break;
    case "peer-join":
      await handlePeerJoin(fromUserId, data);
      break;
    case "offer":
      if (event.toUserId === sessionInfo.userId) {
        await handleOffer(fromUserId, data);
      }
      break;
    case "answer":
      if (event.toUserId === sessionInfo.userId) {
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
      knownParticipants.delete(fromUserId);
      peerDisplayNames.delete(fromUserId);
      break;
    case "end-call":
      console.log(`Received end-call from ${fromUserId}`);
      await endCall(true);
      break;
    case "new-message":
      handleNewMessage(data);
      break;
  }
}

// Setup SSE with reconnection
let sseReconnectAttempts = 0;
const SSE_MAX_RECONNECT_ATTEMPTS = 5;
const SSE_INITIAL_DELAY = 1000; // 1 second

export function setupSignalingSSE() {
  // Close any existing SSE connection first
  if (window.signalingEventSource) {
    window.signalingEventSource.close();
    window.signalingEventSource = null;
  }

  console.log("Setting up SSE connection...");
  // Use EventSource with credentials for cookie-based session
  // Also append sessionId to query param to ensure correct session in multi-user/iframe scenarios
  const eventSource = new EventSource(
    `/api/v1/signaling?sessionId=${sessionInfo.sessionId}`,
    {
      withCredentials: true,
    },
  );

  eventSource.onopen = () => {
    console.log("SSE connection opened");
    sseReconnectAttempts = 0; // Reset on successful connection
    updateConnectionStatus();
    // Note: peer-join is sent after room-state is processed in handleRoomState
  };

  eventSource.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
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
    eventSource.close();
    window.signalingEventSource = null;
    stopConnectionHeartbeat();
    updateConnectionStatus();

    // Limit reconnection attempts
    if (sseReconnectAttempts >= SSE_MAX_RECONNECT_ATTEMPTS) {
      console.error("SSE max reconnection attempts reached. Please refresh.");
      return;
    }

    // Reconnect with exponential backoff
    sseReconnectAttempts++;
    const delay = SSE_INITIAL_DELAY * Math.pow(2, sseReconnectAttempts - 1);
    console.log(
      `SSE reconnecting in ${delay}ms (attempt ${sseReconnectAttempts}/${SSE_MAX_RECONNECT_ATTEMPTS})`,
    );
    setTimeout(setupSignalingSSE, delay);
  };

  window.signalingEventSource = eventSource;
}
