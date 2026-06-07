const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL    = "llama-3.3-70b-versatile";

// Key rotation & persistent cooldown logic
// Key rotation & persistent cooldown logic excluding already attempted keys, filtered by provider
async function getActiveKeyExcluding(attemptedKeys = [], provider = "groq") {
  const data = await chrome.storage.local.get(["groq_api_keys", "current_key_idx", "rate_limit_cooldowns"]);
  
  // Filter by status !== invalid AND provider (defaulting to groq for backwards-compatibility)
  const storedKeys = (data.groq_api_keys || []).filter(k => {
    const kp = k.provider || "groq";
    return k.status !== "invalid" && kp === provider;
  });
  
  if (storedKeys.length === 0) return null;

  let keyIdx = data.current_key_idx || 0;
  if (keyIdx >= storedKeys.length) {
    keyIdx = 0;
  }

  const cooldowns = data.rate_limit_cooldowns || {};
  const now = Date.now();

  for (let i = 0; i < storedKeys.length; i++) {
    const idx = (keyIdx + i) % storedKeys.length;
    const keyString = storedKeys[idx].key;
    
    if (attemptedKeys.includes(keyString)) continue;

    // Check if key is currently in rate-limit cooldown (60 seconds)
    const cooldownTime = cooldowns[keyString] || 0;
    if (now - cooldownTime >= 60000) {
      if (idx !== keyIdx) {
        await chrome.storage.local.set({ current_key_idx: idx });
      }
      return keyString;
    }
  }

  // Fallback: oldest non-attempted key matching provider
  console.warn(`All non-attempted ${provider} keys in cooldown. Returning the one with oldest rate-limit timestamp.`);
  let oldestIdx = -1;
  let oldestTime = Infinity;
  for (let i = 0; i < storedKeys.length; i++) {
    const keyString = storedKeys[i].key;
    if (attemptedKeys.includes(keyString)) continue;

    const cooldownTime = cooldowns[keyString] || 0;
    if (cooldownTime < oldestTime) {
      oldestTime = cooldownTime;
      oldestIdx = i;
    }
  }
  
  if (oldestIdx !== -1) {
    await chrome.storage.local.set({ current_key_idx: oldestIdx });
    return storedKeys[oldestIdx].key;
  }

  return null;
}

async function markKeyExhausted(keyString) {
  const data = await chrome.storage.local.get("rate_limit_cooldowns");
  const cooldowns = data.rate_limit_cooldowns || {};
  cooldowns[keyString] = Date.now();
  await chrome.storage.local.set({ rate_limit_cooldowns: cooldowns });
  console.log(`Key rate-limit cooldown registered in storage.`);
  
  // Try to pre-emptively advance index
  const keysData = await chrome.storage.local.get(["groq_api_keys", "current_key_idx"]);
  const storedKeys = keysData.groq_api_keys || [];
  let currentIdx = keysData.current_key_idx || 0;
  if (storedKeys.length > 0) {
    const nextIdx = (currentIdx + 1) % storedKeys.length;
    await chrome.storage.local.set({ current_key_idx: nextIdx });
  }
}

// Toast sender with auto-injection backup
async function sendToast(tabId, text, variant = "action") {
  const ghostData = await chrome.storage.local.get("ghost_mode");
  const ghost = ghostData.ghost_mode === true;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "agent-toast", text, variant, ghost });
  } catch (err) {
    // If content script is not loaded, attempt to inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      // Retry sending toast
      await chrome.tabs.sendMessage(tabId, { type: "agent-toast", text, variant, ghost });
    } catch (injectErr) {
      console.warn("Could not inject content script or display toast:", injectErr);
    }
  }
}

// Take snapshot of active page
async function getPageSnapshot(tabId) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const radioOptions = [];

        // Method 1: labels with for= attribute
        document.querySelectorAll("label").forEach(lbl => {
          const forId = lbl.getAttribute("for");
          const inp = forId ? document.getElementById(forId) : lbl.querySelector("input[type=radio]");
          if (inp && inp.type === "radio") {
            radioOptions.push({ value: inp.value, text: lbl.innerText.trim(), checked: inp.checked, id: inp.id || "" });
          }
        });

        // Method 2: radios in containers
        if (radioOptions.length === 0) {
          document.querySelectorAll("input[type=radio]").forEach(r => {
            const container = r.closest("li,div,tr,p,span");
            const text = (container?.innerText || r.value || "").trim();
            if (text) radioOptions.push({ value: r.value, text, checked: r.checked, id: r.id });
          });
        }

        // Clickable elements
        const clickables = [];
        const els = document.querySelectorAll("a,button,[role=button],input[type=submit],input[type=button]");
        els.forEach((el, i) => {
          if (i > 30) return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 60);
          if (!text) return;
          clickables.push({ idx: i, tag: el.tagName.toLowerCase(), text, href: el.href || "" });
        });

        // Question number — multiple patterns
        let bodyText = document.body.innerText;
        // Clean up body text to save tokens
        bodyText = bodyText.split('\n')
                           .map(line => line.trim())
                           .filter(line => line.length > 0)
                           .join('\n');

        const qPatterns = [
          /Question\s*(?:No\.?)?\s*[:#]?\s*(\d+)/i,
          /Q\.?\s*(\d+)\s*[/:]/i,
          /(\d+)\s*\/\s*\d+/,
          /Question\s*(\d+)/i
        ];
        let qNum = null;
        for (const p of qPatterns) {
          const m = bodyText.match(p);
          if (m) { qNum = parseInt(m[1]); break; }
        }
        if (qNum === null) {
          const urlM = location.href.match(/[?&/]q(?:uestion)?[=\/](\d+)/i);
          if (urlM) qNum = parseInt(urlM[1]);
        }

        return {
          title: document.title, url: location.href,
          bodyText: bodyText.slice(0, 2500),
          clickables, radioOptions, questionNumber: qNum
        };
      }
    });
    return r[0].result;
  } catch (e) {
    console.error("getPageSnapshot failed:", e);
    return null;
  }
}

async function getSelectedModel() {
  const data = await chrome.storage.local.get("selected_model");
  return data.selected_model || "groq/llama-3.3-70b-versatile";
}

async function resolveModelConfig() {
  const selectedModel = await getSelectedModel();
  if (selectedModel.startsWith("openrouter/")) {
    return {
      provider: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      modelName: selectedModel.replace("openrouter/", "")
    };
  } else {
    return {
      provider: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      modelName: selectedModel.replace("groq/", "")
    };
  }
}

// Call AI API (Groq or OpenRouter) with retries and detailed error handling
async function callGroq(messages, attemptedKeys = []) {
  const config = await resolveModelConfig();
  
  const key = await getActiveKeyExcluding(attemptedKeys, config.provider);
  if (!key) {
    if (attemptedKeys.length > 0) {
      throw new Error(`All ${attemptedKeys.length} configured ${config.provider} keys failed in this request.`);
    }
    throw new Error(`No ${config.provider} API keys found! Add them in the extension options.`);
  }

  let headers = { 
    "Content-Type": "application/json", 
    "Authorization": `Bearer ${key}`
  };
  
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/infernoGurala/utopia-web";
    headers["X-Title"] = "Utopia Agent";
  }

  let res;
  try {
    res = await fetch(config.url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ model: config.modelName, messages, max_tokens: 800, temperature: 0.1 })
    });
  } catch (err) {
    console.error(`Fetch failed for ${config.provider} key:`, key.substring(0, 10), err);
    await markKeyExhausted(key);
    attemptedKeys.push(key);
    return callGroq(messages, attemptedKeys);
  }

  if (res.status === 429 || res.status === 401) {
    await markKeyExhausted(key);
    attemptedKeys.push(key);
    
    // Check if we can retry with a different key for this provider
    const data = await chrome.storage.local.get("groq_api_keys");
    const storedKeys = (data.groq_api_keys || []).filter(k => (k.provider || "groq") === config.provider);
    const untriedKeys = storedKeys.filter(sk => !attemptedKeys.includes(sk.key));
    
    if (untriedKeys.length > 0) {
      return callGroq(messages, attemptedKeys);
    }
    
    const errText = await res.text().catch(() => "Unknown error response");
    throw new Error(`All ${config.provider} keys rate-limited/invalid. Last status: ${res.status}. Response: ${errText.slice(0, 150)}`);
  }
  
  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error response");
    throw new Error(`${config.provider} API returned error ${res.status}: ${errText.slice(0, 150)}`);
  }
  
  const data = await res.json();
  return data.choices[0].message.content;
}

// System prompt
function buildPrompt(snap) {
  const optStr = (snap?.radioOptions || []).length > 0
    ? "\nMCQ OPTIONS — use EXACTLY these texts for select_radio:\n" +
      snap.radioOptions.map((o, i) => `  ${String.fromCharCode(65+i)}) "${o.text}"${o.checked ? " ← currently selected" : ""}`).join("\n")
    : "\n(No radio options detected)";

  return `You are an expert browser automation agent that answers MCQ questions in strict sequential order.

PAGE: "${snap?.title}" — ${snap?.url}
QUESTION NUMBER: ${snap?.questionNumber ?? "unknown"}
${optStr}

CLICKABLE ELEMENTS:
${(snap?.clickables||[]).map(c=>`  [${c.idx}] <${c.tag}> "${c.text}"`).join("\n")}

PAGE TEXT:
${snap?.bodyText || "(restricted page)"}

━━━ RESPONSE FORMAT ━━━
Respond ONLY in this exact format:
<response>
<thinking>
1. Carefully analyze the question and context.
2. Work through the problem step-by-step. Show all logical deductions or calculations.
3. Double-check your reasoning before concluding.
</thinking>
Final conclusion: (brief summary of the answer)
</response>
<actions>[{"action":"ACTION","params":{}}]</actions>

━━━ ACTIONS ━━━
- select_radio: {"text":"EXACT_OPTION_TEXT"}
- click_next: {}   ← ONLY use this to move to the NEXT question (NEVER submit)
- click: {"selector":"text:BUTTON_TEXT"}
- click_xy: {"x":NUMBER,"y":NUMBER}
- scroll: {"direction":"down","amount":400}
- type: {"selector":"text:PLACEHOLDER","text":"VALUE"}
- navigate: {"url":"https://..."}
- none: {}

━━━ STRICT RULES ━━━
1. Answer questions ONE BY ONE in sequential order — do NOT skip any question.
2. For MCQ: ALWAYS output EXACTLY [select_radio({"text":"..."}), click_next({})]
3. NEVER use click_next if a SUBMIT button is visible — use none:{} instead.
4. NEVER click any button labeled Submit, Finish, or End Test.
5. Use EXACT option text from MCQ OPTIONS above — do not paraphrase.
6. Do the math step by step before choosing.
7. If no radio options visible, use [click_next()] to advance.
8. NEVER repeat an action on the same question.`;
}

// Parse AI response with robust fallbacks for smaller models
function parseAI(raw) {
  const tM = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const rM = raw.match(/<response>([\s\S]*?)<\/response>/);
  const aM = raw.match(/<actions>([\s\S]*?)<\/actions>/);
  
  let text = "Analyzing question and executing...";
  if (tM) {
    text = tM[1].trim().slice(0, 150).replace(/\n/g, ' ') + "...";
  } else if (rM) {
    text = rM[1].trim().slice(0, 150).replace(/\n/g, ' ') + "...";
  }
  
  let actions = [];
  if (aM) {
    try { actions = JSON.parse(aM[1].trim()); } catch {
      const arrM = aM[1].match(/\[[\s\S]*\]/);
      if (arrM) { try { actions = JSON.parse(arrM[0]); } catch {} }
    }
  }
  
  // Robust fallback 1: Search for any JSON array containing actions
  if (actions.length === 0) {
    const jsonArrayMatch = raw.match(/\[\s*\{\s*"action"[\s\S]*\}\s*\]/);
    if (jsonArrayMatch) {
      try { actions = JSON.parse(jsonArrayMatch[0]); } catch {}
    }
  }

  // Robust fallback 2: Check if there's any markdown JSON block
  if (actions.length === 0) {
    const jsonBlockMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1].trim());
        actions = Array.isArray(parsed) ? parsed : [parsed];
      } catch {}
    }
  }

  // Robust fallback 3: Single action object
  if (actions.length === 0) {
    const singleActionMatch = raw.match(/\{\s*"action"\s*:[\s\S]*?\}/);
    if (singleActionMatch) {
      try {
        const parsed = JSON.parse(singleActionMatch[0]);
        actions = [parsed];
      } catch {}
    }
  }

  return { text, actions };
}

// Execute actions
async function executeActions(tabId, actions) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const a of actions) {
    if (a.action === "none") continue;
    try {
      if (a.action === "navigate") {
        await chrome.tabs.update(tabId, { url: a.params.url });
        await sleep(1500);
      } else if (a.action === "go_back") {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => history.back()
        });
        await sleep(1500);
      } else {
        await chrome.scripting.executeScript({ target: { tabId }, func: runAction, args: [a] });
      }
    } catch (e) {
      console.error(`Action failed: ${a.action}`, e);
    }
    await sleep(400);
  }
}

// Helper runAction executed inside tab context
function runAction({action, params}) {
  function find(sel) {
    if (!sel) return null;
    if (sel.startsWith("text:")) {
      const t = sel.slice(5).toLowerCase().trim();
      const candidates = document.querySelectorAll("a,button,[role=button],input,textarea,select,label,span,div,li");
      let best = null, bestLen = Infinity;
      for (const el of candidates) {
        const txt = (el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase();
        if (txt.includes(t) && txt.length < bestLen) { best = el; bestLen = txt.length; }
      }
      return best;
    }
    try { return document.querySelector(sel); } catch { return null; }
  }

  function robustClick(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior:"smooth", block:"center" });
    if (el.tagName === "LABEL") {
      const forId = el.getAttribute("for");
      const input = forId ? document.getElementById(forId) : el.querySelector("input[type=radio],input[type=checkbox]");
      if (input) {
        input.checked = true;
        ["mousedown","mouseup","click"].forEach(t => input.dispatchEvent(new MouseEvent(t, {bubbles:true})));
        input.dispatchEvent(new Event("change", {bubbles:true}));
        el.dispatchEvent(new MouseEvent("click", {bubbles:true}));
        return true;
      }
    }
    if (el.type === "radio" || el.type === "checkbox") {
      el.checked = true;
      ["mousedown","mouseup","click"].forEach(t => el.dispatchEvent(new MouseEvent(t, {bubbles:true})));
      el.dispatchEvent(new Event("change", {bubbles:true}));
      return true;
    }
    ["mousedown","mouseup"].forEach(t => el.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true})));
    el.click();
    return true;
  }

  switch(action) {
    case "scroll":
      if (params.direction === "top") window.scrollTo({top:0,behavior:"smooth"});
      else if (params.direction === "bottom") window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"});
      else if (params.direction === "up") window.scrollBy({top:-(params.amount||400),behavior:"smooth"});
      else window.scrollBy({top:(params.amount||400),behavior:"smooth"});
      break;

    case "click": {
      const el = find(params.selector);
      if (el) robustClick(el);
      else return "NOT_FOUND: " + params.selector;
      break;
    }

    case "click_next": {
      const allBtns = [...document.querySelectorAll("a, button, input[type=submit], input[type=button], [role=button]")];
      const isSubmit = el => /(submit|finish|end test|end quiz|done)/i.test((el.innerText || el.value || "").trim());
      const eligible = allBtns.filter(el => !isSubmit(el));
      let btn = eligible.find(el => /next/i.test(el.innerText || el.value || ""))
             || eligible.find(el => /→|>|»/.test(el.innerText || ""));
      if (btn) {
        btn.scrollIntoView({block:"center"});
        ["mousedown","mouseup"].forEach(t => btn.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true})));
        btn.click();
        if (btn.tagName === "A" && btn.href && !btn.href.startsWith("javascript")) {
          window.location.href = btn.href;
        }
        return "clicked: " + (btn.innerText || btn.value || "button");
      }
      return "NOT_FOUND: next button (Submit blocked)";
    }

    case "click_xy": {
      const el = document.elementFromPoint(params.x, params.y);
      if (el) robustClick(el);
      break;
    }

    case "select_radio": {
      const text = (params.text || "").toLowerCase().trim();
      const labels = [...document.querySelectorAll("label")];
      let matched = labels.find(lbl => lbl.innerText.toLowerCase().trim() === text)
                 || labels.find(lbl => lbl.innerText.toLowerCase().includes(text));
      if (matched) { robustClick(matched); break; }
      const radios = [...document.querySelectorAll("input[type=radio]")];
      for (const r of radios) {
        const nearby = (r.closest("li,div,tr,p,td,span")?.innerText || r.value || "").toLowerCase();
        if (nearby.includes(text)) { robustClick(r); break; }
      }
      break;
    }

    case "type": {
      const el = find(params.selector);
      if (el) {
        el.focus(); el.value = "";
        el.dispatchEvent(new Event("input", {bubbles:true}));
        for (const ch of params.text) { el.value += ch; el.dispatchEvent(new Event("input", {bubbles:true})); }
        el.dispatchEvent(new Event("change", {bubbles:true}));
      }
      break;
    }

    case "navigate":
      window.location.href = params.url;
      break;
  }
}

// Core Solver Logic
async function solveCurrentQuestion(tabId) {
  // Toast feedback: start
  await sendToast(tabId, "Analyzing question...", "action");

  try {
    const config = await resolveModelConfig();
    // Check if API keys exist
    const activeKey = await getActiveKeyExcluding([], config.provider);
    if (!activeKey) {
      await sendToast(tabId, `No ${config.provider} API keys configured! Click the extension icon to add one.`, "error");
      return;
    }

    // Take snapshot of page
    const snap = await getPageSnapshot(tabId);
    if (!snap) {
      await sendToast(tabId, "Could not capture page content.", "error");
      return;
    }

    await sendToast(tabId, "Thinking...", "action");

    // Query AI
    const messages = [
      { role: "system", content: buildPrompt(snap) },
      { role: "user",   content: "Answer this question." }
    ];

    const raw = await callGroq(messages);
    console.log("AI raw response:", raw);
    const { text, actions } = parseAI(raw);
    
    console.log("AI thinking:", text);

    // Execute actions (excluding submit/finish, click_next, or navigation for single question)
    if (actions && actions.length > 0) {
      const safeActions = actions.filter(a => {
        if (a.action === "click" && /(submit|finish|end test|end quiz|done)/i.test(a.params?.selector || "")) return false;
        if (a.action === "click_next" || a.action === "navigate") return false;
        return true;
      });

      if (safeActions.length > 0) {
        await sendToast(tabId, `Selecting: ${text.slice(0, 80)}`, "action");
        
        await executeActions(tabId, safeActions);
        await sendToast(tabId, "Question answered successfully! ✓", "success");
      } else {
        await sendToast(tabId, "No safe action to perform.", "action");
      }
    } else {
      await sendToast(tabId, "No action returned by AI.", "error");
    }

  } catch (err) {
    console.error(err);
    await sendToast(tabId, `Error: ${err.message}`, "error");
  }
}

// Toggle Extension Activated State
function updateExtensionUI(enabled) {
  if (enabled) {
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#a8e5a3" });
    chrome.action.setTitle({ title: "Utopia Agent (Active) - Press Ctrl+Shift+S to solve" });
  } else {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#8c1d18" });
    chrome.action.setTitle({ title: "Utopia Agent (Inactive) - Click to activate" });
  }
}

// Update UI on load or startup
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get("extension_enabled");
  const enabled = data.extension_enabled !== false;
  updateExtensionUI(enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get("extension_enabled");
  const enabled = data.extension_enabled !== false;
  updateExtensionUI(enabled);
});

// Storage change listener to update Badge UI dynamically when state is toggled from popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.extension_enabled) {
    const enabled = changes.extension_enabled.newValue !== false;
    updateExtensionUI(enabled);
  }
});

// Main Shortcut Command Listener
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "answer_question") {
    console.log("Utopia Agent shortcut triggered.");
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    // Check if activated
    const data = await chrome.storage.local.get("extension_enabled");
    const enabled = data.extension_enabled !== false;
    
    if (!enabled) {
      await sendToast(tab.id, "Utopia Agent is deactivated! Click the extension icon in the toolbar to activate.", "error");
      return;
    }
    
    await solveCurrentQuestion(tab.id);
  }
});
