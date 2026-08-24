/**
 * Voyvista ERP - AI Assistant Module Script
 */

document.addEventListener("DOMContentLoaded", () => {
  // ---------------------------------------------------------------------------
  // 1. Elements Selection
  // ---------------------------------------------------------------------------
  const chatMessages = document.getElementById("ai-chat-messages");
  const chatForm = document.getElementById("ai-chat-form");
  const userInput = document.getElementById("ai-user-input");
  const btnSend = document.getElementById("btn-ai-send");

  // ---------------------------------------------------------------------------
  // 2. Chat UI Helpers
  // ---------------------------------------------------------------------------
  function appendMessage(sender, text) {
    if (!chatMessages) return;

    const messageDiv = document.createElement("div");
    messageDiv.className = `ai-msg ai-msg--${sender}`;
    
    // Formatting text for simple line breaks
    const formattedText = text.replace(/\n/g, "<br>");

    messageDiv.innerHTML = `
      <div class="ai-msg__avatar">
        ${sender === "user" ? "👤" : "🤖"}
      </div>
      <div class="ai-msg__content">
        <div class="ai-msg__text">${formattedText}</div>
        <span class="ai-msg__time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.id = "ai-typing";
    indicator.className = "ai-msg ai-msg--bot ai-typing";
    indicator.innerHTML = `
      <div class="ai-msg__avatar">🤖</div>
      <div class="ai-msg__content">
        <div class="ai-msg__text">جاري التفكير...</div>
      </div>
    `;
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById("ai-typing");
    if (indicator) indicator.remove();
  }

  // ---------------------------------------------------------------------------
  // 3. API Communication / Fallback Handler
  // ---------------------------------------------------------------------------
  async function getAIResponse(prompt) {
    const token = localStorage.getItem("access_token") || localStorage.getItem("token");

    try {
      // إذا كان الباك إند جاهزاً لاستقبال الاستفسارات
      if (typeof API_BASE_URL !== "undefined" && API_BASE_URL) {
        const response = await fetch(`${API_BASE_URL}/api/ai/chat/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ prompt }),
        });

        if (response.ok) {
          const data = await response.json();
          return data.reply || data.response || "تم استلام الطلب بنجاح.";
        }
      }
    } catch (err) {
      console.warn("AI Backend not responding, using offline response mode.");
    }

    // الرد الافتراضي المحلي للواجهة (في حال عدم اتصال الباك إند بعد)
    return `مرحباً بك! أنا مساعد Voyvista الذكي. استلمت استفسارك: "${prompt}". كيف يمكنني مساعدتك أكثر في إدارة المبيعات أو الحسابات؟`;
  }

  // ---------------------------------------------------------------------------
  // 4. Event Handlers
  // ---------------------------------------------------------------------------
  chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = userInput.value.trim();
    if (!text) return;

    // Clear input
    userInput.value = "";
    if (btnSend) btnSend.disabled = true;

    // Render User Message
    appendMessage("user", text);

    // Show Typing
    showTypingIndicator();

    // Get Response & Render
    const reply = await getAIResponse(text);
    removeTypingIndicator();
    appendMessage("bot", reply);

    if (btnSend) btnSend.disabled = false;
    userInput.focus();
  });
});