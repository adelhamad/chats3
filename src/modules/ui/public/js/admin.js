/* eslint-disable no-undef */
document
  .getElementById("createConversationForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const conversationId = document.getElementById("conversationId").value;
    const adminPassword = document.getElementById("adminPassword").value;
    const resultDiv = document.getElementById("result");

    try {
      const response = await fetch("/api/v1/admin/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          adminPassword,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const joinLink = `${window.location.origin}/join?conversationId=${conversationId}&joinCode=${data.details.joinCode}`;
        resultDiv.innerHTML = `
        <strong>Success!</strong><br>
        Join Code: ${data.details.joinCode}<br>
        Share Link: <a href="${joinLink}" target="_blank">${joinLink}</a>
      `;
        resultDiv.className = "result success";
        resultDiv.style.display = "block";
      } else {
        throw new Error(data.message || "Failed to create conversation");
      }
    } catch (error) {
      resultDiv.textContent = error.message;
      resultDiv.className = "result error";
      resultDiv.style.display = "block";
    }
  });
