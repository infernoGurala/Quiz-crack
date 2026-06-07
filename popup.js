const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

// Elements
const toggleCard = document.getElementById("toggleCard");
const toggleValue = document.getElementById("toggleValue");
const toggleSwitchIcon = document.getElementById("toggleSwitchIcon");

const apiKeyInput = document.getElementById("apiKeyInput");
const toggleVisibility = document.getElementById("toggleVisibility");
const visibilityIcon = document.getElementById("visibilityIcon");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keysList = document.getElementById("keysList");
const statusMessage = document.getElementById("statusMessage");
const statusText = document.getElementById("statusText");
const statusIcon = document.getElementById("statusIcon");
const modelSelect = document.getElementById("modelSelect");
const keyProviderSelect = document.getElementById("keyProviderSelect");

let savedKeys = [];

// Toggle Password Visibility
toggleVisibility.addEventListener("click", () => {
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    visibilityIcon.textContent = "visibility";
  } else {
    apiKeyInput.type = "password";
    visibilityIcon.textContent = "visibility_off";
  }
});

// Load Settings from Storage
async function loadSettings() {
  // 1. Load Keys
  const data = await chrome.storage.local.get("groq_api_keys");
  savedKeys = data.groq_api_keys || [];
  renderKeys();

  // 2. Load Model
  const modelData = await chrome.storage.local.get("selected_model");
  if (modelData.selected_model) {
    modelSelect.value = modelData.selected_model;
  }

  // Sync provider and placeholder with selected model
  syncProviderWithModel();

  // 3. Load Active State
  const stateData = await chrome.storage.local.get("extension_enabled");
  const enabled = stateData.extension_enabled !== false; // default to true
  updateToggleUI(enabled);
}

// Update Toggle Switch UI State
function updateToggleUI(enabled) {
  if (enabled) {
    toggleCard.classList.add("active");
    toggleValue.textContent = "Active";
    toggleSwitchIcon.textContent = "toggle_on";
  } else {
    toggleCard.classList.remove("active");
    toggleValue.textContent = "Inactive";
    toggleSwitchIcon.textContent = "toggle_off";
  }
}

// Toggle Activation State on Click
toggleCard.addEventListener("click", async () => {
  const stateData = await chrome.storage.local.get("extension_enabled");
  const currentlyEnabled = stateData.extension_enabled !== false;
  const nextState = !currentlyEnabled;
  
  await chrome.storage.local.set({ extension_enabled: nextState });
  updateToggleUI(nextState);
  showStatus(nextState ? "Utopia Agent Activated" : "Utopia Agent Deactivated", "success");
});

// Sync key provider dropdown and placeholder with selected model
function syncProviderWithModel() {
  const modelValue = modelSelect.value;
  const provider = modelValue.split('/')[0]; // 'groq' or 'openrouter'
  keyProviderSelect.value = provider;
  updateKeyInputPlaceholder(provider);
}

function updateKeyInputPlaceholder(provider) {
  if (provider === "groq") {
    apiKeyInput.placeholder = "gsk_...";
  } else {
    apiKeyInput.placeholder = "sk-or-...";
  }
}

// Model select listener
modelSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ selected_model: modelSelect.value });
  syncProviderWithModel();
  showStatus(`Model updated to ${modelSelect.value}`, "success");
});

// Key provider manual select listener
keyProviderSelect.addEventListener("change", () => {
  updateKeyInputPlaceholder(keyProviderSelect.value);
});

// Render Stored Keys list
function renderKeys() {
  keysList.innerHTML = "";

  if (savedKeys.length === 0) {
    keysList.innerHTML = `<div class="empty-keys">No API keys saved. Add one above!</div>`;
    return;
  }

  savedKeys.forEach((keyData, index) => {
    const item = document.createElement("div");
    item.className = "key-item";

    const provider = keyData.provider || "groq";
    const maskedKey = maskKey(keyData.key);
    const statusText = keyData.status === "valid" ? "Verified" : keyData.status === "invalid" ? "Invalid key" : "Not tested";
    const statusClass = keyData.status === "valid" ? "active" : keyData.status === "invalid" ? "invalid" : "";

    item.innerHTML = `
      <div class="key-info">
        <div class="key-masked" title="${keyData.key}">${maskedKey}</div>
        <div class="key-status">
          <span class="status-dot ${statusClass}"></span>
          <span style="text-transform: uppercase; font-weight: 600; color: var(--primary);">[${provider}]</span>
          <span>${statusText}</span>
        </div>
      </div>
      <div class="key-actions">
        <button class="icon-btn icon-btn-test" data-index="${index}" title="Test key validity">
          <span class="material-symbols-rounded">check_circle</span>
        </button>
        <button class="icon-btn icon-btn-delete" data-index="${index}" title="Delete key">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    `;

    keysList.appendChild(item);
  });

  // Wire buttons
  document.querySelectorAll(".icon-btn-test").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(btn.dataset.index);
      testKey(idx);
    });
  });

  document.querySelectorAll(".icon-btn-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(btn.dataset.index);
      deleteKey(idx);
    });
  });
}

function maskKey(key) {
  if (key.length <= 12) return "••••••••";
  return key.substring(0, 7) + "••••••••" + key.substring(key.length - 5);
}

// Add Key
saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  const provider = keyProviderSelect.value;

  if (!key) {
    showStatus("Please enter an API key.", "error");
    return;
  }
  if (provider === "groq" && !key.startsWith("gsk_")) {
    showStatus("Warning: Groq key should start with 'gsk_'.", "info");
  } else if (provider === "openrouter" && !key.startsWith("sk-or-")) {
    showStatus("Warning: OpenRouter key should start with 'sk-or-'.", "info");
  }

  // Check duplicate
  if (savedKeys.some(k => k.key === key)) {
    showStatus("This API key is already added.", "error");
    return;
  }

  saveKeyBtn.disabled = true;
  showStatus("Validating and adding key...", "info");

  const isValid = await validateApiKey(key, provider);

  if (isValid) {
    savedKeys.push({ key: key, provider: provider, status: "valid" });
    await chrome.storage.local.set({ groq_api_keys: savedKeys });
    apiKeyInput.value = "";
    showStatus("API Key successfully validated and added!", "success");
    renderKeys();
  } else {
    showStatus("Could not validate key. Please check it and try again.", "error");
  }
  saveKeyBtn.disabled = false;
});

// Delete Key
async function deleteKey(index) {
  savedKeys.splice(index, 1);
  await chrome.storage.local.set({ groq_api_keys: savedKeys });
  showStatus("API Key deleted.", "info");
  renderKeys();
}

// Test Key
async function testKey(index) {
  showStatus(`Testing key ${index + 1}...`, "info");
  const keyData = savedKeys[index];
  const provider = keyData.provider || "groq";
  const isValid = await validateApiKey(keyData.key, provider);
  
  savedKeys[index].status = isValid ? "valid" : "invalid";
  await chrome.storage.local.set({ groq_api_keys: savedKeys });
  
  if (isValid) {
    showStatus(`Key ${index + 1} is valid!`, "success");
  } else {
    showStatus(`Key ${index + 1} is invalid. Check connection/credentials.`, "error");
  }
  renderKeys();
}

// Validate Key against Provider Endpoint
async function validateApiKey(key, provider) {
  try {
    if (provider === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${key}`
        }
      });
      return response.ok;
    } else {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${key}`
        }
      });
      return response.ok;
    }
  } catch (err) {
    console.error("Error validating key:", err);
    return false;
  }
}

// Show Alert Banner
function showStatus(message, type) {
  statusText.textContent = message;
  statusMessage.className = `status-msg ${type}`;
  
  if (type === "success") {
    statusIcon.textContent = "check_circle";
  } else if (type === "error") {
    statusIcon.textContent = "error";
  } else {
    statusIcon.textContent = "info";
  }
  
  statusMessage.style.display = "flex";
  
  setTimeout(() => {
    if (statusText.textContent === message) {
      statusMessage.style.display = "none";
    }
  }, 5000);
}

// Initialize
document.addEventListener("DOMContentLoaded", loadSettings);
