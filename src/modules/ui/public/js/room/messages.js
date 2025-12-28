/* eslint-disable no-undef */
// Message display and history

import {
  $,
  apiFetch,
  sessionInfo,
  peerConnections,
  lastSeenMap,
  scrollToBottom,
} from "./state.js";

export function updateLastSeen(userId, timestamp) {
  const current = lastSeenMap.get(userId);
  if (!current || new Date(timestamp) > new Date(current)) {
    lastSeenMap.set(userId, timestamp);
  }
}

export function formatLastSeen(timestamp) {
  if (!timestamp) {
    return "Offline";
  }
  const date = new Date(timestamp);
  const diff = Date.now() - date;
  if (diff < 60000) {
    return "Last seen: Just now";
  }
  if (diff < 3600000) {
    return `Last seen: ${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `Last seen: ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `Last seen: ${date.toLocaleDateString()}`;
}

export function updateAllUserStatuses() {
  lastSeenMap.forEach((timestamp, userId) => {
    if (!peerConnections.has(userId)) {
      updateAvatarStatus(userId, false, timestamp);
    }
  });
}

export function updateAvatarStatus(userId, isOnline, lastSeenTime) {
  const avatars = document.querySelectorAll(`.user-avatar-${userId}`);
  avatars.forEach((el) => {
    el.classList.remove("online", "offline");
    el.classList.add(isOnline ? "online" : "offline");
    el.title = isOnline ? "Online" : formatLastSeen(lastSeenTime);
  });
}

function getAvatar(name, userId, avatarUrl) {
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

  if (userId) {
    div.classList.add(`user-avatar-${userId}`);
    if (peerConnections.has(userId)) {
      div.classList.add("online");
      div.title = "Online";
    } else {
      div.classList.add("offline");
      div.title = formatLastSeen(lastSeenMap.get(userId));
    }
  }

  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = name;
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;border-radius:50%";
    div.appendChild(img);
    div.style.backgroundColor = "transparent";
  } else {
    div.textContent = initials;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    div.style.backgroundColor = "#" + "00000".substring(0, 6 - c.length) + c;
  }
  return div;
}

function renderMessageBody(message, bodyDiv) {
  if (message.type === "file") {
    if (message.mimetype?.startsWith("image/")) {
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
  wrapper.style.cssText = "display:flex;flex-direction:column;gap:5px";

  const img = document.createElement("img");
  img.src = message.url;
  img.style.cssText =
    "max-width:200px;max-height:200px;border-radius:8px;cursor:pointer;object-fit:cover";
  img.onclick = () => window.open(message.url, "_blank");
  img.onload = scrollToBottom;

  const downloadLink = document.createElement("a");
  downloadLink.href = message.url;
  downloadLink.target = "_blank";
  downloadLink.textContent = "⬇ Download";
  downloadLink.style.cssText =
    "font-size:12px;color:#5682a3;text-decoration:none;margin-top:4px";

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
  link.style.cssText = "color:#3498db;text-decoration:none";
  container.appendChild(link);
}

export function displayMessage(message) {
  if (message.senderUserId && message.senderUserId !== sessionInfo.userId) {
    const ts = message.serverReceivedAt || message.clientTimestamp;
    updateLastSeen(message.senderUserId, ts);
    if (!peerConnections.has(message.senderUserId)) {
      updateAvatarStatus(message.senderUserId, false, ts);
    }
  }

  if (
    message.messageId &&
    document.querySelector(`[data-message-id="${message.messageId}"]`)
  ) {
    return;
  }

  const isOwn =
    message.senderUserId === sessionInfo.userId ||
    (message.senderDisplayName &&
      message.senderDisplayName === sessionInfo.displayName);
  const isSystem = message.type === "system";

  function getRowClass() {
    if (isSystem) {
      return "system";
    }
    return isOwn ? "own" : "other";
  }

  const rowDiv = document.createElement("div");
  rowDiv.className = `message-row ${getRowClass()}`;

  if (!isOwn && !isSystem) {
    rowDiv.appendChild(
      getAvatar(
        message.senderDisplayName || "User",
        message.senderUserId,
        message.senderAvatarUrl,
      ),
    );
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${getRowClass()}`;
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
  timeSpan.textContent = timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  headerDiv.appendChild(senderSpan);
  headerDiv.appendChild(timeSpan);

  if (isOwn) {
    const statusSpan = document.createElement("span");
    statusSpan.className = "message-status";
    statusSpan.id = `status-${message.messageId}`;
    statusSpan.textContent = "✓";
    statusSpan.title = "Sent";
    headerDiv.appendChild(statusSpan);
  }

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "message-body";
  renderMessageBody(message, bodyDiv);

  messageDiv.appendChild(headerDiv);
  messageDiv.appendChild(bodyDiv);
  rowDiv.appendChild(messageDiv);
  $.messagesDiv.appendChild(rowDiv);
  scrollToBottom();
}

export async function loadMessageHistory() {
  const loader = document.getElementById("messagesLoader");
  try {
    const response = await apiFetch("/api/v1/messages");
    const data = await response.json();

    if (loader) {
      loader.remove();
    }

    if (data.success && data.details) {
      data.details.forEach(displayMessage);
      updateAllUserStatuses();
    }
  } catch (error) {
    console.error("Failed to load history:", error);
    if (loader) {
      loader.innerHTML = "<span>Failed to load messages.</span>";
    }
  }
}
