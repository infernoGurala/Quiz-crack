// Content script — injected into every page
// Provides a toast notification system for agent feedback

(function () {
  if (window.__agentInjected) return;
  window.__agentInjected = true;

  // Create toast container
  const toastContainer = document.createElement("div");
  toastContainer.id = "__agent-toasts";
  toastContainer.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Roboto', 'Segoe UI', sans-serif;
  `;
  document.body?.appendChild(toastContainer);

  function showToast(message, type = "action") {
    // Muted Ghost Glassmorphism Theme Colors
    const colors = {
      action: { bg: "rgba(26, 21, 35, 0.75)", text: "rgba(208, 188, 255, 0.9)", border: "rgba(208, 188, 255, 0.15)" },
      success: { bg: "rgba(15, 30, 18, 0.75)", text: "rgba(168, 229, 163, 0.9)", border: "rgba(168, 229, 163, 0.15)" },
      error: { bg: "rgba(60, 20, 20, 0.8)", text: "rgba(242, 184, 181, 0.9)", border: "rgba(242, 184, 181, 0.2)" },
    };
    const c = colors[type] || colors.action;

    const toast = document.createElement("div");
    toast.style.cssText = `
      background: ${c.bg};
      color: ${c.text};
      border: 1px solid ${c.border};
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      max-width: 320px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: 0.1px;
    `;

    const iconSpan = document.createElement("span");
    iconSpan.style.opacity = "0.7";
    iconSpan.style.fontSize = "14px";
    iconSpan.textContent = "🤖";
    
    const textSpan = document.createElement("span");
    textSpan.textContent = message;

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(5px)";
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "agent-toast") {
      showToast(msg.text, msg.variant || "action");
    }
  });

  window.__agentShowToast = showToast;
})();
