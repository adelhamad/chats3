/* eslint-disable no-undef */
// Signaling and WebRTC peer connections

import { endCall } from "./call.js";
import {
  displayMessage,
  updateLastSeen,
  updateAvatarStatus,
} from "./messages.js";
import {
  $,
  sessionId,
  sessionInfo,
  peerConnections,
  dataChannels,
  localStream,
  apiFetch,
} from "./state.js";

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

  const onlineCount = peerConnections.size + 1;
  const peersText = onlineCount > 1 ? `${onlineCount} in room` : "";

  peerConnections.forEach((pc, userId) => updateAvatarStatus(userId, true));

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

// Create peer connection
export async function createPeerConnection(peerId, initiator) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
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
    updateConnectionStatus();
  };

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
      wrapper.style.cssText = "position:relative;min-width:200px";

      videoEl = document.createElement("video");
      videoEl.id = `remote-video-${peerId}`;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.style.cssText =
        "width:200px;height:150px;background:#000;border-radius:8px;object-fit:cover";

      const label = document.createElement("span");
      label.textContent = `User ${peerId.substr(0, 4)}`;
      label.style.cssText =
        "position:absolute;bottom:5px;left:5px;color:white;font-size:12px;background:rgba(0,0,0,0.5);padding:2px 5px;border-radius:4px";

      wrapper.appendChild(videoEl);
      wrapper.appendChild(label);
      $.remoteVideosDiv.appendChild(wrapper);
      $.videoContainer.style.display = "block";
    }
    videoEl.srcObject = stream;
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

// Close peer connection
export function closePeerConnection(peerId) {
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

  const videoEl = document.getElementById(`remote-video-${peerId}`);
  if (videoEl) {
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

// Handle signaling event
async function handleSignalingEvent(event) {
  const { type, fromUserId, data } = event;
  console.log(`Handling signaling event: ${type} from ${fromUserId}`);

  switch (type) {
    case "peer-join":
      if (fromUserId !== sessionInfo.userId) {
        console.log(`Peer joined: ${fromUserId}. Initiating connection...`);
        await createPeerConnection(fromUserId, true);
      }
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
      break;
    case "end-call":
      console.log(`Received end-call from ${fromUserId}`);
      await endCall(true);
      break;
    case "new-message":
      if (
        data.messageId &&
        !document.querySelector(`[data-message-id="${data.messageId}"]`)
      ) {
        displayMessage(data);
      }
      break;
  }
}

// Setup SSE
export function setupSignalingSSE() {
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
    if (eventSource.readyState === EventSource.CLOSED) {
      updateConnectionStatus();
    }
  };

  window.signalingEventSource = eventSource;
}
