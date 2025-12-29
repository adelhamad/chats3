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

    if (sessionResponse.status === 401) {
      console.warn("Session invalid or expired. Redirecting to join.");
      window.location.href = `/join?conversationId=${window.CONVERSATION_ID}`;
      return;
    }

    const sessionData = await sessionResponse.json();

    if (!sessionData.success) {
      console.warn("Session check failed:", sessionData.message);
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

// Show upload progress indicator
function showUploadProgress() {
  const progressDiv = document.createElement("div");
  progressDiv.id = "uploadProgress";
  progressDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 20px 40px;
    border-radius: 10px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  `;
  progressDiv.innerHTML = `
    <div style="font-size: 14px;">Uploading file...</div>
    <div style="width: 200px; height: 6px; background: #333; border-radius: 3px; overflow: hidden;">
      <div id="uploadProgressBar" style="width: 0%; height: 100%; background: #0088cc; transition: width 0.2s;"></div>
    </div>
    <div id="uploadProgressText" style="font-size: 12px;">0%</div>
  `;
  document.body.appendChild(progressDiv);
  return progressDiv;
}

function updateUploadProgress(percent) {
  const bar = document.getElementById("uploadProgressBar");
  const text = document.getElementById("uploadProgressText");
  if (bar) {
    bar.style.width = `${percent}%`;
  }
  if (text) {
    text.textContent = `${percent}%`;
  }
}

function hideUploadProgress() {
  const progressDiv = document.getElementById("uploadProgress");
  if (progressDiv) {
    progressDiv.remove();
  }
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
      // Show progress indicator
      showUploadProgress();

      const attachment = await uploadFile(selectedFile, updateUploadProgress);

      hideUploadProgress();

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
    hideUploadProgress();
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
