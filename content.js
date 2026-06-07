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

  // Ghost Mode — subtle translucent glassmorphism
  const ghostColors = {
    action:  { bg: "rgba(26, 21, 35, 0.55)", text: "rgba(208, 188, 255, 0.75)", border: "rgba(208, 188, 255, 0.1)" },
    success: { bg: "rgba(15, 30, 18, 0.55)", text: "rgba(168, 229, 163, 0.75)", border: "rgba(168, 229, 163, 0.1)" },
    error:   { bg: "rgba(60, 20, 20, 0.6)",  text: "rgba(242, 184, 181, 0.8)",  border: "rgba(242, 184, 181, 0.15)" },
  };

  // Normal Mode — solid and visible
  const normalColors = {
    action:  { bg: "#2B2930", text: "#D0BCFF", border: "rgba(208, 188, 255, 0.2)" },
    success: { bg: "#1a2e1a", text: "#A8E5A3", border: "rgba(168, 229, 163, 0.25)" },
    error:   { bg: "#3c1414", text: "#F9DEDC", border: "rgba(242, 184, 181, 0.3)" },
  };

  function showToast(message, type = "action", ghost = false) {
    const palette = ghost ? ghostColors : normalColors;
    const c = palette[type] || palette.action;

    const fontSize = ghost ? "12px" : "14px";
    const padding  = ghost ? "6px 12px" : "10px 16px";
    const maxW     = ghost ? "280px" : "360px";
    const blur     = ghost ? "blur(10px)" : "blur(4px)";
    const shadow   = ghost
      ? "0 2px 8px rgba(0, 0, 0, 0.2)"
      : "0 4px 14px rgba(0, 0, 0, 0.35)";
    const iconOpacity = ghost ? "0.5" : "0.85";
    const duration = ghost ? 2500 : 4000;

    const toast = document.createElement("div");
    toast.style.cssText = `
      background: ${c.bg};
      color: ${c.text};
      border: 1px solid ${c.border};
      padding: ${padding};
      border-radius: 8px;
      font-size: ${fontSize};
      font-weight: 500;
      max-width: ${maxW};
      box-shadow: ${shadow};
      backdrop-filter: ${blur};
      -webkit-backdrop-filter: ${blur};
      opacity: 0;
      transform: translateY(8px);
      transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.1px;
    `;

    const iconSpan = document.createElement("span");
    iconSpan.style.opacity = iconOpacity;
    iconSpan.style.fontSize = ghost ? "12px" : "15px";
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
    }, duration);
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "agent-toast") {
      showToast(msg.text, msg.variant || "action", msg.ghost === true);
    }
  });

  window.__agentShowToast = showToast;
})();
