/* eslint-disable no-undef */
// Join page JavaScript
// Pre-fill from URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("conversationId")) {
  document.getElementById("conversationId").value =
    urlParams.get("conversationId");
}
if (urlParams.has("joinCode")) {
  document.getElementById("joinCode").value = urlParams.get("joinCode");
}

document.getElementById("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const conversationId = document.getElementById("conversationId").value;
  const joinCode = document.getElementById("joinCode").value;
  const displayName = document.getElementById("displayName").value;
  const avatarUrl = document.getElementById("avatarUrl").value;

  const errorDiv = document.getElementById("error");
  errorDiv.style.display = "none";

  try {
    const response = await fetch("/api/v1/join", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        joinCode,
        displayName,
        avatarUrl: avatarUrl || undefined,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      errorDiv.textContent = data.message || "Failed to join conversation";
      errorDiv.style.display = "block";
      return;
    }

    // Store session ID for multi-chat support
    if (data.details && data.details.sessionId) {
      sessionStorage.setItem(
        `chat_session_${conversationId}`,
        data.details.sessionId,
      );
    }

    // Redirect to room
    if (data.details && data.details.sessionId) {
      window.location.href = `/room/${conversationId}?sessionId=${data.details.sessionId}`;
    } else {
      window.location.href = `/room/${conversationId}`;
    }
  } catch (error) {
    errorDiv.textContent = "Network error: " + error.message;
    errorDiv.style.display = "block";
  }
});
