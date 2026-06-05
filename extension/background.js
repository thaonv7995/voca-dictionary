const MENU_ID = "voca-add-word";
const DEFAULT_SETTINGS = {
  apiPort: "22053",
  baseURL: "",
  apiKey: "",
  model: "",
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add \"%s\" to Voca Dictionary",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: `${MENU_ID}-focused`,
    title: "Add focused word to Voca Dictionary",
    contexts: ["page", "editable"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID && info.menuItemId !== `${MENU_ID}-focused`) return;
  addFromTab(tab, info.selectionText);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "add-selection") return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    addFromTab(tab);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "voca:add-word") return false;
  resolveMessageTab(message, sender).then((tab) => addWord(message.word, tab, message.jobId)).then(sendResponse);
  return true;
});

async function addFromTab(tab, fallbackWord = "") {
  if (!tab?.id) return;
  const detected = await detectWord(tab.id);
  const word = cleanWord(fallbackWord || detected.word);
  const result = await addWord(word, tab, createJobId());
  if (!result.ok && result.needsOptions) {
    chrome.runtime.openOptionsPage();
  }
}

async function detectWord(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "voca:get-word" });
  } catch {
    return { word: "" };
  }
}

async function resolveMessageTab(message, sender) {
  if (sender.tab) return sender.tab;
  if (message?.tabId) {
    try {
      return await chrome.tabs.get(message.tabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function addWord(rawWord, tab, requestedJobId) {
  const jobId = requestedJobId || createJobId();
  const word = cleanWord(rawWord);
  if (!word) {
    notify(tab, "Select or focus a word first.", { error: true, jobId });
    return { ok: false, error: "Select or focus a word first." };
  }

  const settings = await getSettings();
  if (!settings.baseURL || !settings.apiKey || !settings.model) {
    const message = "Configure extension AI settings first.";
    notify(tab, message, { error: true, jobId, word });
    return { ok: false, error: message, needsOptions: true };
  }

  notify(tab, `Creating card for "${word}"...`, { progress: true, step: "start", jobId, word });
  try {
    const response = await fetch(`https://voca-bridge.thaonv.online/create-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word,
        settings: {
          baseURL: settings.baseURL,
          apiKey: settings.apiKey,
          model: settings.model,
        },
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Create card failed (${response.status})`);
    }

    const events = await readNdjson(response, (event) => {
      const message = progressMessage(event);
      if (message) {
        notify(tab, message, { progress: true, step: event.type || "progress", jobId, word });
      }
    });
    const failed = events.find((event) => event.type === "error");
    if (failed) throw new Error(failed.message || "Cannot create card.");
    const done = [...events].reverse().find((event) => event.type === "done");
    const skipped = done?.skipped?.length || 0;
    notify(tab, skipped ? `"${word}" already exists.` : `Added "${word}".`, { jobId, word });
    return { ok: true, jobId };
  } catch (error) {
    const message = error?.message?.includes("Failed to fetch")
      ? "Open VocaMenuBar or run npm run voca:api."
      : error?.message || "Cannot add word.";
    notify(tab, message, { error: true, jobId, word });
    return { ok: false, error: message, jobId };
  }
}

async function readNdjson(response, onEvent) {
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const event = parseEvent(line);
      if (event) {
        events.push(event);
        onEvent?.(event);
      }
    }
  }

  buffer += decoder.decode();
  const event = parseEvent(buffer);
  if (event) {
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { type: "log", message: trimmed };
  }
}

function progressMessage(event) {
  if (!event || event.type === "done" || event.type === "error") return "";
  if (event.message) return event.message;
  if (event.type === "log") return event.message || "Working...";
  return `${event.type}...`;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    apiPort: cleanPort(stored.apiPort),
  };
}

function cleanPort(value) {
  const port = String(value || DEFAULT_SETTINGS.apiPort).trim();
  return /^\d{2,5}$/.test(port) ? port : DEFAULT_SETTINGS.apiPort;
}

function cleanWord(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim()
    .slice(0, 120);
}

function createJobId() {
  return `voca-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function notify(tab, message, options = {}) {
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, {
    type: "voca:toast",
    message,
    error: Boolean(options.error),
    progress: Boolean(options.progress),
    step: options.step || "",
    jobId: options.jobId || "",
    word: options.word || "",
  }).catch(() => undefined);
}


