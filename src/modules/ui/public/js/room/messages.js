/* eslint-disable no-undef */
// Message display and history

import {
  $,
  apiFetch,
  sessionInfo,
  peerConnections,
  lastSeenMap,
  messageReactions,
  REACTIONS,
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
    // Show text if it's not the default file marker
    if (message.body && !message.body.startsWith("[File] ")) {
      const textDiv = document.createElement("div");
      textDiv.textContent = message.body;
      textDiv.style.marginBottom = "8px";
      textDiv.style.whiteSpace = "pre-wrap";
      bodyDiv.appendChild(textDiv);
    }

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

// Create message header with sender, time, and status
function createMessageHeader(message, isOwn) {
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

  return headerDiv;
}

// Add reactions container and button to message
function addReactionsToMessage(messageDiv, messageId, isOwn) {
  const reactionsDiv = document.createElement("div");
  reactionsDiv.className = "message-reactions";
  reactionsDiv.id = `reactions-${messageId}`;
  messageDiv.appendChild(reactionsDiv);

  // Reaction picker button (only for OTHER users' messages)
  if (!isOwn) {
    const addReactionBtn = document.createElement("button");
    addReactionBtn.className = "add-reaction-btn";
    addReactionBtn.textContent = "😊";
    addReactionBtn.title = "Add reaction";
    addReactionBtn.onclick = (e) => {
      e.stopPropagation();
      showReactionPicker(messageId, addReactionBtn);
    };
    messageDiv.appendChild(addReactionBtn);
  }
}

// Get CSS class for message row
function getMessageRowClass(isSystem, isOwn) {
  if (isSystem) {
    return "system";
  }
  return isOwn ? "own" : "other";
}

export function displayMessage(message) {
  // Update last seen for other users
  const isOtherUser =
    message.senderUserId && message.senderUserId !== sessionInfo.userId;
  if (isOtherUser) {
    const ts = message.serverReceivedAt || message.clientTimestamp;
    updateLastSeen(message.senderUserId, ts);
    if (!peerConnections.has(message.senderUserId)) {
      updateAvatarStatus(message.senderUserId, false, ts);
    }
  }

  // Skip duplicate messages
  const isDuplicate =
    message.messageId &&
    document.querySelector(`[data-message-id="${message.messageId}"]`);
  if (isDuplicate) {
    return;
  }

  const isOwn =
    message.senderUserId === sessionInfo.userId ||
    (message.senderDisplayName &&
      message.senderDisplayName === sessionInfo.displayName);
  const isSystem = message.type === "system";
  const rowClass = getMessageRowClass(isSystem, isOwn);

  const rowDiv = document.createElement("div");
  rowDiv.className = `message-row ${rowClass}`;

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
  messageDiv.className = `message ${rowClass}`;
  if (message.messageId) {
    messageDiv.setAttribute("data-message-id", message.messageId);
  }

  messageDiv.appendChild(createMessageHeader(message, isOwn));

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "message-body";
  renderMessageBody(message, bodyDiv);
  messageDiv.appendChild(bodyDiv);

  // Add reactions (for all non-system messages)
  if (!isSystem && message.messageId) {
    addReactionsToMessage(messageDiv, message.messageId, isOwn);
  }

  rowDiv.appendChild(messageDiv);
  $.messagesDiv.appendChild(rowDiv);
  scrollToBottom();
}

export async function loadMessageHistory() {
  const loader = document.getElementById("messagesLoader");
  try {
    // Load messages and reactions in parallel
    const [messagesRes, reactionsRes] = await Promise.all([
      apiFetch("/api/v1/messages"),
      apiFetch("/api/v1/reactions"),
    ]);
    const messagesData = await messagesRes.json();
    const reactionsData = await reactionsRes.json();

    if (loader) {
      loader.remove();
    }

    // Load reactions into state
    if (reactionsData.success && reactionsData.details) {
      for (const [messageId, emojis] of Object.entries(reactionsData.details)) {
        const msgReactions = new Map();
        for (const [emoji, users] of Object.entries(emojis)) {
          msgReactions.set(emoji, new Set(users));
        }
        messageReactions.set(messageId, msgReactions);
      }
    }

    if (messagesData.success && messagesData.details) {
      messagesData.details.forEach(displayMessage);
      updateAllUserStatuses();
      // Update reaction displays after messages are rendered
      for (const messageId of messageReactions.keys()) {
        updateReactionDisplay(messageId);
      }
    }
  } catch (error) {
    console.error("Failed to load history:", error);
    if (loader) {
      loader.innerHTML = "<span>Failed to load messages.</span>";
    }
  }
}

// Reaction picker
let currentPicker = null;

function showReactionPicker(messageId, button) {
  // Close any existing picker
  if (currentPicker) {
    currentPicker.remove();
    currentPicker = null;
  }

  const picker = document.createElement("div");
  picker.className = "reaction-picker";
  REACTIONS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.textContent = emoji;
    btn.onclick = () => {
      // Import sendReaction dynamically to avoid circular dependency
      import("./signaling.js").then((mod) =>
        mod.sendReaction(messageId, emoji),
      );
      picker.remove();
      currentPicker = null;
    };
    picker.appendChild(btn);
  });

  button.parentElement.appendChild(picker);
  currentPicker = picker;

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", function closeHandler() {
      if (currentPicker) {
        currentPicker.remove();
        currentPicker = null;
      }
      document.removeEventListener("click", closeHandler);
    });
  }, 0);
}

export function updateReactionDisplay(messageId) {
  const container = document.getElementById(`reactions-${messageId}`);
  if (!container) {
    return;
  }

  container.innerHTML = "";
  const reactions = messageReactions.get(messageId);
  if (!reactions || reactions.size === 0) {
    return;
  }

  // Check if this is the user's own message (reactions should be view-only)
  const messageEl = container.closest(".message");
  const isOwnMessage = messageEl?.classList.contains("own");

  reactions.forEach((users, emoji) => {
    if (users.size === 0) {
      return;
    }
    const badge = document.createElement("span");
    badge.className = "reaction-badge";
    badge.textContent = `${emoji} ${users.size}`;
    badge.title = `${users.size} reaction${users.size > 1 ? "s" : ""}`;
    // Only allow clicking to add reaction on OTHER users' messages
    if (!isOwnMessage) {
      badge.onclick = () => {
        import("./signaling.js").then((mod) =>
          mod.sendReaction(messageId, emoji),
        );
      };
    }
    if (users.has(sessionInfo.userId)) {
      badge.classList.add("own-reaction");
    }
    container.appendChild(badge);
  });
}
