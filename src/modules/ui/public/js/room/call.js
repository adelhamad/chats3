/* eslint-disable no-undef */
// WebRTC call management

import { sendSignalingEvent } from "./signaling.js";
import {
  $,
  peerConnections,
  localStream,
  setLocalStream,
  screenStream,
  setScreenStream,
  isScreenSharing,
  setIsScreenSharing,
} from "./state.js";

// Start Video Call
export async function startCall() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    setLocalStream(stream);

    // Ensure local video is muted to prevent feedback
    $.localVideo.muted = true;
    $.localVideo.srcObject = stream;
    $.videoContainer.style.display = "block";

    // Update UI
    $.callButton.style.display = "none";
    $.audioBtn.style.display = "inline-block";
    $.videoBtn.style.display = "inline-block";
    $.screenBtn.style.display = "inline-block";
    $.recordButton.style.display = "inline-block";
    $.endCallButton.style.display = "inline-block";

    // Add tracks to all existing peer connections
    // The onnegotiationneeded handler will trigger renegotiation automatically
    for (const [peerId, pc] of peerConnections.entries()) {
      console.log(`Adding tracks to peer connection with ${peerId}`);
      stream.getTracks().forEach((track) => {
        // Check if track is already added
        const senders = pc.getSenders();
        const existingSender = senders.find(
          (s) => s.track?.kind === track.kind,
        );
        if (!existingSender) {
          pc.addTrack(track, stream);
        } else if (existingSender.track !== track) {
          existingSender.replaceTrack(track);
        }
      });
    }
  } catch (error) {
    console.error("Error starting call:", error);
    alert("Could not start call: " + error.message);
  }
}

// Toggle Audio
export function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      $.audioBtn.textContent = audioTrack.enabled ? "🎤" : "🎤🚫";
      $.audioBtn.style.backgroundColor = audioTrack.enabled
        ? "#34495e"
        : "#95a5a6";
    }
  }
}

// Toggle Video
export function toggleVideo() {
  if (isScreenSharing) {
    stopScreenShare();
    return;
  }
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      $.videoBtn.textContent = videoTrack.enabled ? "📷" : "📷🚫";
      $.videoBtn.style.backgroundColor = videoTrack.enabled
        ? "#34495e"
        : "#95a5a6";
    }
  }
}

// Toggle Screen Share
export async function toggleScreenShare() {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    setScreenStream(stream);
    const screenTrack = stream.getVideoTracks()[0];

    screenTrack.onended = () => stopScreenShare();

    for (const pc of peerConnections.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(screenTrack);
      }
    }

    $.localVideo.srcObject = stream;
    setIsScreenSharing(true);
    $.screenBtn.style.backgroundColor = "#2ecc71";
  } catch (error) {
    console.error("Error starting screen share:", error);
  }
}

function stopScreenShare() {
  if (!isScreenSharing) {
    return;
  }

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
  }

  if (localStream) {
    const cameraTrack = localStream.getVideoTracks()[0];
    for (const pc of peerConnections.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        sender.replaceTrack(cameraTrack);
      }
    }
    $.localVideo.srcObject = localStream;
  }

  setIsScreenSharing(false);
  $.screenBtn.style.backgroundColor = "#34495e";
}

// End Video Call
export async function endCall(isRemote = false) {
  if (typeof isRemote === "object") {
    isRemote = false;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
  }

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
  }

  $.localVideo.srcObject = null;
  $.videoContainer.style.display = "none";
  $.remoteVideosDiv.innerHTML = "";

  $.callButton.style.display = "inline-block";
  $.audioBtn.style.display = "none";
  $.videoBtn.style.display = "none";
  $.screenBtn.style.display = "none";
  $.recordButton.style.display = "none";
  $.stopRecordButton.style.display = "none";
  $.endCallButton.style.display = "none";

  for (const [peerId, pc] of peerConnections.entries()) {
    pc.getSenders().forEach((sender) => {
      if (sender.track?.kind !== "data") {
        pc.removeTrack(sender);
      }
    });

    if (!isRemote) {
      try {
        await sendSignalingEvent("end-call", peerId, {});
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignalingEvent("offer", peerId, offer);
      } catch (err) {
        console.error("Error sending end-call signal:", err);
      }
    }
  }

  $.videoContainer.style.display = "none";
}
