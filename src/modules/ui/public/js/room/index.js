/* eslint-disable no-undef */
// Room main entry point

import {
  startCall,
  toggleAudio,
  toggleVideo,
  toggleScreenShare,
  endCall,
} from "./call.js";
import { handleFileSelect, handlePaste, uploadFile } from "./files.js";
import { displayMessage, loadMessageHistory } from "./messages.js";
import { startRecording, stopRecording } from "./recording.js";
import { initSearch } from "./search.js";
import {
  setupSignalingSSE,
  sendSignalingEvent,
  broadcastViaDataChannel,
  broadcastTyping,
} from "./signaling.js";
import {
  $,
  apiFetch,
  setSessionInfo,
  sessionInfo,
  peerConnections,
  selectedFile,
  setSelectedFile,
  generateUUID,
  scrollToBottom,
} from "./state.js";

// Initialize
async function init() {
  try {
    const sessionResponse = await apiFetch("/api/v1/session");
    const sessionData = await sessionResponse.json();

    if (!sessionData.success) {
      alert("No valid session. Please join again.");
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
      return;
    }

    setSessionInfo(sessionData.details);

    if (sessionInfo.conversationId !== window.CONVERSATION_ID) {
      console.warn("Session conversation mismatch. Redirecting to join.");
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
      return;
    }

    $.userNameSpan.textContent = sessionInfo.displayName;

    // Handle embedded mode UI
    const isEmbedded = window.self !== window.top;
    if (isEmbedded) {
      $.callButton.style.display = "none";
      $.recordButton.style.display = "none";
      $.leaveButton.style.display = "none";
    }

    await loadMessageHistory();
    scrollToBottom();
    setupSignalingSSE();

    await sendSignalingEvent("peer-join", undefined, {
      userId: sessionInfo.userId,
      displayName: sessionInfo.displayName,
    });

    // Event listeners
    $.sendButton.addEventListener("click", sendMessage);
    $.messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    $.messageInput.addEventListener("input", () => {
      $.messageInput.style.height = "auto";
      $.messageInput.style.height = $.messageInput.scrollHeight + "px";
      broadcastTyping(true);
    });

    $.attachButton.addEventListener("click", () => $.fileInput.click());
    $.fileInput.addEventListener("change", handleFileSelect);

    $.callButton.addEventListener("click", startCall);
    $.audioBtn.addEventListener("click", toggleAudio);
    $.videoBtn.addEventListener("click", toggleVideo);
    $.screenBtn.addEventListener("click", toggleScreenShare);
    $.endCallButton.addEventListener("click", endCall);

    $.recordButton.addEventListener("click", startRecording);
    $.stopRecordButton.addEventListener("click", stopRecording);

    $.leaveButton.addEventListener("click", leaveConversation);

    window.addEventListener("beforeunload", handleUnload);
    document.addEventListener("paste", handlePaste);

    initSearch();
  } catch (error) {
    console.error("Initialization error:", error);
    alert("Failed to initialize chat");
  }
}

async function leaveConversation() {
  if (confirm("Are you sure you want to leave the conversation?")) {
    try {
      await apiFetch("/api/v1/leave", { method: "POST" });
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
    } catch (error) {
      console.error("Error leaving conversation:", error);
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
    }
  }
}

function handleUnload() {
  // Note: peer-leave is handled automatically by SSE connection close on server
}

async function sendMessage() {
  if (peerConnections.size === 0) {
    alert("Cannot send message: Waiting for other participants to join.");
    return;
  }

  const body = $.messageInput.value.trim();
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
      setSelectedFile(null);
      $.previewContainer.innerHTML = "";
      $.previewContainer.style.display = "none";
    } else {
      message = { ...message, type: "text", body };
    }

    displayMessage(message);
    $.messageInput.value = "";
    $.messageInput.style.height = "auto";

    broadcastViaDataChannel(message);
    await saveMessageToBackend(message);
  } catch (error) {
    console.error("Failed to send message:", error);
    alert("Failed to send message: " + error.message);
  }
}

async function saveMessageToBackend(message) {
  const response = await apiFetch("/api/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error("Failed to save message");
  }
}

// Start
init();
