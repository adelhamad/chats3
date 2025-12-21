// Join page JavaScript
document.getElementById('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const conversationId = document.getElementById('conversationId').value;
  const joinCode = document.getElementById('joinCode').value;
  const displayName = document.getElementById('displayName').value;
  const avatarUrl = document.getElementById('avatarUrl').value;

  const errorDiv = document.getElementById('error');
  errorDiv.style.display = 'none';

  try {
    const response = await fetch('/api/v1/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      errorDiv.textContent = data.message || 'Failed to join conversation';
      errorDiv.style.display = 'block';
      return;
    }

    // Redirect to room
    window.location.href = `/room/${conversationId}`;
  } catch (error) {
    errorDiv.textContent = 'Network error: ' + error.message;
    errorDiv.style.display = 'block';
  }
});
