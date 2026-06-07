// Elements
const toggleCard = document.getElementById("toggleCard");
const toggleValue = document.getElementById("toggleValue");
const toggleSwitchIcon = document.getElementById("toggleSwitchIcon");

const ghostToggleCard = document.getElementById("ghostToggleCard");
const ghostToggleValue = document.getElementById("ghostToggleValue");
const ghostSwitchIcon = document.getElementById("ghostSwitchIcon");
const ghostStatusIcon = document.getElementById("ghostStatusIcon");

const apiKeyInput = document.getElementById("apiKeyInput");
const toggleVisibility = document.getElementById("toggleVisibility");
const visibilityIcon = document.getElementById("visibilityIcon");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keysList = document.getElementById("keysList");
const statusMessage = document.getElementById("statusMessage");
const statusText = document.getElementById("statusText");
const statusIcon = document.getElementById("statusIcon");
const modelSelect = document.getElementById("modelSelect");

let savedKeys = [];

// Model metadata dictionary
const MODEL_METADATA = {
  "google/gemini-2.5-flash": {
    context: "1,048,576 tokens",
    caps: "⚡ Ultra-fast, extremely cost-effective, great for general knowledge and speed."
  },
  "google/gemini-2.5-pro": {
    context: "1,048,576 tokens",
    caps: "🧠 Outstanding reasoning, perfect for complex math, science, and long context."
  },
  "anthropic/claude-sonnet-4.6": {
    context: "1,000,000 tokens",
    caps: "🎯 Best-in-class reasoning, logical thinking, and high-accuracy answer selection."
  },
  "anthropic/claude-sonnet-4.5": {
    context: "1,000,000 tokens",
    caps: "✨ Highly intelligent, exceptional reasoning, logic, and factual recall."
  },
  "anthropic/claude-sonnet-4": {
    context: "1,000,000 tokens",
    caps: "🔍 Highly intelligent, great reasoning, structure, and accuracy."
  },
  "openai/gpt-5.5-pro": {
    context: "1,050,000 tokens",
    caps: "🏆 State-of-the-art general intelligence, logic, and complex MCQ parsing."
  },
  "openai/gpt-5.4-mini": {
    context: "400,000 tokens",
    caps: "⚡ Fast, lightweight, high accuracy for standard quiz questions."
  },
  "deepseek/deepseek-r1": {
    context: "163,840 tokens",
    caps: "🧩 Advanced reasoning, deep chain-of-thought, superb for math and hard science."
  },
  "deepseek/deepseek-chat": {
    context: "131,072 tokens",
    caps: "🚀 Fast, powerful, extremely cheap, excellent reasoning for general topics."
  },
  "meta-llama/llama-3.3-70b-instruct": {
    context: "131,072 tokens",
    caps: "🦙 High-performance open-weights model, excellent instruction following."
  },
  "meta-llama/llama-3.3-70b-instruct:free": {
    context: "131,072 tokens",
    caps: "🎁 Completely free to use, highly capable open model."
  }
};

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
  // 1. Run Storage Migration if needed (groq_api_keys -> openrouter_api_keys)
  const keysData = await chrome.storage.local.get(["groq_api_keys", "openrouter_api_keys"]);
  if (keysData.groq_api_keys && !keysData.openrouter_api_keys) {
    const migrated = keysData.groq_api_keys.filter(k => k.provider === "openrouter");
    await chrome.storage.local.set({ openrouter_api_keys: migrated });
    await chrome.storage.local.remove("groq_api_keys");
    savedKeys = migrated;
  } else {
    savedKeys = keysData.openrouter_api_keys || [];
  }
  renderKeys();

  // 2. Load Model
  const modelData = await chrome.storage.local.get("selected_model");
  if (modelData.selected_model) {
    // If the saved model is a Groq model, map it to a default OpenRouter model
    if (modelData.selected_model.startsWith("groq/")) {
      modelSelect.value = "openrouter/google/gemini-2.5-flash";
      await chrome.storage.local.set({ selected_model: "openrouter/google/gemini-2.5-flash" });
    } else {
      modelSelect.value = modelData.selected_model;
    }
  } else {
    modelSelect.value = "openrouter/google/gemini-2.5-flash";
  }

  // Update details card for the selected model
  updateModelDetails();

  // 3. Load Active State
  const stateData = await chrome.storage.local.get("extension_enabled");
  const enabled = stateData.extension_enabled !== false; // default to true
  updateToggleUI(enabled);

  // 4. Load Ghost Mode State
  const ghostData = await chrome.storage.local.get("ghost_mode");
  const ghostEnabled = ghostData.ghost_mode === true;
  updateGhostToggleUI(ghostEnabled);
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

// Update Ghost Mode Toggle UI State
function updateGhostToggleUI(enabled) {
  if (enabled) {
    ghostToggleCard.classList.add("active");
    ghostToggleValue.textContent = "On";
    ghostSwitchIcon.textContent = "toggle_on";
    ghostStatusIcon.textContent = "visibility_off";
  } else {
    ghostToggleCard.classList.remove("active");
    ghostToggleValue.textContent = "Off";
    ghostSwitchIcon.textContent = "toggle_off";
    ghostStatusIcon.textContent = "visibility";
  }
}

// Ghost Mode Toggle Click
ghostToggleCard.addEventListener("click", async () => {
  const ghostData = await chrome.storage.local.get("ghost_mode");
  const currentlyEnabled = ghostData.ghost_mode === true;
  const nextState = !currentlyEnabled;

  await chrome.storage.local.set({ ghost_mode: nextState });
  updateGhostToggleUI(nextState);
  showStatus(nextState ? "Ghost Mode enabled — silent solver" : "Ghost Mode disabled — normal toasts", "success");
});

// Toggle Activation State on Click
toggleCard.addEventListener("click", async () => {
  const stateData = await chrome.storage.local.get("extension_enabled");
  const currentlyEnabled = stateData.extension_enabled !== false;
  const nextState = !currentlyEnabled;
  
  await chrome.storage.local.set({ extension_enabled: nextState });
  updateToggleUI(nextState);
  showStatus(nextState ? "Utopia Agent Activated" : "Utopia Agent Deactivated", "success");
});

// Update dynamic model info in the details card
function updateModelDetails() {
  const model = modelSelect.value;
  // Strip the 'openrouter/' prefix when matching the key
  const metaKey = model.startsWith("openrouter/") ? model.replace("openrouter/", "") : model;
  
  const meta = MODEL_METADATA[metaKey] || {
    context: "Unknown",
    caps: "OpenRouter LLM model."
  };
  document.getElementById("modelContextLimit").textContent = meta.context;
  document.getElementById("modelCapabilities").textContent = meta.caps;
}

// Model select listener
modelSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ selected_model: modelSelect.value });
  updateModelDetails();
  showStatus(`Model updated to ${modelSelect.value}`, "success");
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

    const provider = keyData.provider || "openrouter";
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
  const provider = "openrouter";

  if (!key) {
    showStatus("Please enter an API key.", "error");
    return;
  }
  if (!key.startsWith("sk-or-")) {
    showStatus("Warning: OpenRouter key should start with 'sk-or-'.", "info");
  }

  // Check duplicate
  if (savedKeys.some(k => k.key === key)) {
    showStatus("This API key is already added.", "error");
    return;
  }

  saveKeyBtn.disabled = true;
  showStatus("Validating and adding key...", "info");

  const isValid = await validateApiKey(key);

  if (isValid) {
    savedKeys.push({ key: key, provider: provider, status: "valid" });
    await chrome.storage.local.set({ openrouter_api_keys: savedKeys });
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
  await chrome.storage.local.set({ openrouter_api_keys: savedKeys });
  showStatus("API Key deleted.", "info");
  renderKeys();
}

// Test Key
async function testKey(index) {
  showStatus(`Testing key ${index + 1}...`, "info");
  const keyData = savedKeys[index];
  const isValid = await validateApiKey(keyData.key);
  
  savedKeys[index].status = isValid ? "valid" : "invalid";
  await chrome.storage.local.set({ openrouter_api_keys: savedKeys });
  
  if (isValid) {
    showStatus(`Key ${index + 1} is valid!`, "success");
  } else {
    showStatus(`Key ${index + 1} is invalid. Check connection/credentials.`, "error");
  }
  renderKeys();
}

// Validate Key against OpenRouter Endpoint
async function validateApiKey(key) {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${key}`
      }
    });
    return response.ok;
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
