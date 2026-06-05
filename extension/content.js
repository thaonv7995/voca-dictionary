let lastContextWord = "";
let activeBubble = null;
let activeBubbleWord = "";
const progressToasts = new Map();
const resultToasts = new Set();

let showBubble = true;
let showToasts = true;

// Initial settings load
chrome.storage.local.get({ showBubble: true, showToasts: true }).then((settings) => {
  showBubble = settings.showBubble;
  showToasts = settings.showToasts;
});

// Update settings when changed
chrome.storage.onChanged.addListener((changes) => {
  if (changes.showBubble) showBubble = changes.showBubble.newValue;
  if (changes.showToasts) showToasts = changes.showToasts.newValue;
});

document.addEventListener("contextmenu", (event) => {
  lastContextWord = wordFromPoint(event.clientX, event.clientY) || wordFromSelection() || wordFromFocusedElement();
}, true);

document.addEventListener("mouseup", () => {
  window.setTimeout(() => {
    if (!showBubble) return;
    const word = wordFromSelection();
    if (!word) return;
    const rect = selectionRect();
    if (rect) showAddBubble(word, rect.left + rect.width / 2, rect.top);
  }, 0);
}, true);

document.addEventListener("dblclick", (event) => {
  window.setTimeout(() => {
    if (!showBubble) return;
    const word = wordFromSelection() || wordFromPoint(event.clientX, event.clientY);
    if (word) showAddBubble(word, event.clientX, event.clientY, { compact: true });
  }, 0);
}, true);

document.addEventListener("keyup", (event) => {
  if (!showBubble) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) return;
  const word = wordFromFocusedElement();
  if (!word) return;
  const rect = focusedElementRect();
  if (rect) showAddBubble(word, rect.left + Math.min(rect.width / 2, 220), rect.top, { compact: true });
}, true);

document.addEventListener("selectionchange", () => {
  const word = wordFromSelection();
  if (!word && activeBubble) hideBubble();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "voca:get-word") {
    sendResponse({ word: wordFromSelection() || wordFromFocusedElement() || lastContextWord });
    return false;
  }

  if (message?.type === "voca:toast") {
    if (!showToasts) return false;
    if (message.progress) {
      showProgressToast(message.jobId, message.message, message.word);
      return false;
    }
    showToast(message.message, { error: message.error, jobId: message.jobId });
    return false;
  }

  return false;
});

function wordFromSelection() {
  const selection = window.getSelection();
  return cleanWord(selection?.toString() || "");
}

function selectionRect() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  return rect;
}

function focusedElementRect() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return null;
  return element.getBoundingClientRect();
}

function wordFromFocusedElement() {
  const element = document.activeElement;
  if (!element) return "";

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const value = element.value || "";
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? start;
    if (end > start) return cleanWord(value.slice(start, end));
    return wordNearOffset(value, start);
  }

  if (element.isContentEditable) {
    return wordFromSelection();
  }

  return "";
}

function wordFromPoint(x, y) {
  const range = caretRangeFromPoint(x, y);
  if (!range?.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) return "";
  return wordNearOffset(range.startContainer.textContent || "", range.startOffset);
}

// Fallback for getting text container range from click coordinates
function caretRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  return null;
}

function wordNearOffset(text, offset) {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const isWord = (char) => /[\p{L}\p{N}'-]/u.test(char);
  let start = safeOffset;
  let end = safeOffset;

  if (start === text.length && start > 0) start -= 1;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  while (end < text.length && isWord(text[end])) end += 1;
  if (start === end && safeOffset < text.length && isWord(text[safeOffset])) end += 1;
  return cleanWord(text.slice(start, end));
}

function cleanWord(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim()
    .slice(0, 120);
}

function showAddBubble(word, x, y, options = {}) {
  const clean = cleanWord(word);
  if (!clean) return;
  activeBubbleWord = clean;
  if (activeBubble) activeBubble.remove();

  ensureBubbleStyles();

  const bubble = document.createElement("div");
  bubble.dataset.vocaBubble = "true";
  bubble.className = "voca-bubble";
  if (options.compact) {
    bubble.classList.add("voca-bubble-compact");
  }

  const label = document.createElement("span");
  label.className = "voca-bubble-label";
  label.textContent = clean;
  label.title = clean;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "voca-bubble-btn";
  if (options.compact) {
    button.classList.add("voca-bubble-btn-compact");
  }
  button.textContent = options.compact ? "+" : "Add to Voca";
  button.title = `Add "${clean}" to Voca`;
  button.setAttribute("aria-label", `Add ${clean} to Voca`);

  const progress = document.createElement("span");
  progress.dataset.vocaProgress = "true";

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    button.textContent = options.compact ? "..." : "Adding...";
    progress.style.display = "inline-block";

    const jobId = createJobId();
    if (showToasts) {
      showProgressToast(jobId, "Starting...", activeBubbleWord);
    }
    
    const response = await sendRuntimeMessage({ type: "voca:add-word", word: activeBubbleWord, jobId });
    
    if (!response?.ok) {
      button.disabled = false;
      button.textContent = options.compact ? "!" : "Retry";
      progress.style.display = "none";
      if (showToasts) {
        showToast(response?.error || "Cannot add word.", { error: true, jobId });
      }
    } else {
      button.textContent = options.compact ? "✓" : "Added";
      progress.style.display = "none";
      setTimeout(hideBubble, 1200);
    }
  });

  bubble.append(label, progress, button);
  document.documentElement.appendChild(bubble);
  activeBubble = bubble;

  const bubbleRect = bubble.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - bubbleRect.width - 8, x - bubbleRect.width / 2));
  const top = Math.max(8, y - bubbleRect.height - 10);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;

  requestAnimationFrame(() => {
    bubble.classList.add("voca-show");
  });
}

async function sendRuntimeMessage(message) {
  try {
    if (!chrome?.runtime?.id) {
      throw new Error("Extension context invalidated.");
    }
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: extensionErrorMessage(error) };
  }
}

function extensionErrorMessage(error) {
  const raw = error?.message || String(error || "");
  if (raw.includes("Extension context invalidated") || raw.includes("message channel closed")) {
    return "Extension was reloaded. Refresh this page and try again.";
  }
  return raw || "Cannot contact Voca extension.";
}

function updateBubbleAddingState() {
  if (!activeBubble) return;
  const button = activeBubble.querySelector(".voca-bubble-btn");
  const progress = activeBubble.querySelector("[data-voca-progress]");
  if (button) {
    button.disabled = true;
    button.textContent = "Adding...";
  }
  if (progress) {
    progress.style.display = "inline-block";
  }
}

function hideBubble() {
  if (!activeBubble) return;
  activeBubble.classList.remove("voca-show");
  const el = activeBubble;
  activeBubble = null;
  activeBubbleWord = "";
  setTimeout(() => {
    el.remove();
  }, 200);
}

function showToast(message, options = {}) {
  if (!showToasts) return;
  const error = Boolean(options.error);
  removeProgressToast(options.jobId);
  hideBubble();
  ensureBubbleStyles();

  const toast = document.createElement("div");
  toast.className = "voca-toast";
  if (error) {
    toast.classList.add("voca-toast-error");
  } else {
    toast.classList.add("voca-toast-success");
  }

  const icon = document.createElement("span");
  icon.className = "voca-toast-icon";
  icon.textContent = error ? "!" : "✓";

  const text = document.createElement("span");
  text.className = "voca-toast-text";
  text.textContent = message;

  toast.append(icon, text);
  document.documentElement.appendChild(toast);
  resultToasts.add(toast);
  layoutCornerToasts();

  requestAnimationFrame(() => {
    toast.classList.add("voca-show");
  });

  window.setTimeout(() => {
    toast.classList.remove("voca-show");
    setTimeout(() => {
      toast.remove();
      resultToasts.delete(toast);
      layoutCornerToasts();
    }, 300);
  }, error ? 4500 : 3000);
}

function showProgressToast(jobId, message, word = "") {
  if (!showToasts) return;
  updateBubbleAddingState();
  ensureBubbleStyles();

  const key = jobId || "voca-default";
  let toast = progressToasts.get(key);
  
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "voca-toast";
    toast.dataset.vocaJobId = key;

    const spinner = document.createElement("span");
    spinner.className = "voca-spinner";

    const content = document.createElement("span");
    content.className = "voca-toast-content";

    const title = document.createElement("span");
    title.className = "voca-toast-title";
    title.textContent = word ? `Adding "${word}"` : "Adding word";

    const text = document.createElement("span");
    text.className = "voca-toast-text";
    text.dataset.vocaProgressText = "true";

    content.append(title, text);
    toast.append(spinner, content);
    document.documentElement.appendChild(toast);
    progressToasts.set(key, toast);

    requestAnimationFrame(() => {
      toast.classList.add("voca-show");
    });
  }

  const text = toast.querySelector("[data-voca-progress-text]");
  if (text) text.textContent = message;
  layoutCornerToasts();
}

function removeProgressToast(jobId) {
  if (!jobId) return;
  const toast = progressToasts.get(jobId);
  if (!toast) return;
  
  toast.classList.remove("voca-show");
  progressToasts.delete(jobId);
  
  setTimeout(() => {
    toast.remove();
    layoutCornerToasts();
  }, 300);
}

function layoutCornerToasts() {
  const gap = 12;
  let offset = 20;
  const active = [...resultToasts, ...progressToasts.values()].filter((toast) => toast.isConnected);
  for (const toast of active) {
    toast.style.bottom = `${offset}px`;
    offset += toast.getBoundingClientRect().height + gap;
  }
}

function createJobId() {
  return `voca-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureBubbleStyles() {
  if (document.querySelector("[data-voca-style]")) return;
  const style = document.createElement("style");
  style.dataset.vocaStyle = "true";
  style.textContent = `
    /* Design system defaults */
    :root {
      --voca-bg: rgba(255, 255, 255, 0.9);
      --voca-border: rgba(216, 217, 223, 0.9);
      --voca-ink: #111113;
      --voca-muted: #5c5e66;
      --voca-accent: #2563eb;
      --voca-accent-hover: #1d4ed8;
      --voca-toast-bg: rgba(17, 17, 19, 0.96);
      --voca-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
      --voca-shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.15);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --voca-bg: rgba(24, 24, 27, 0.9);
        --voca-border: rgba(63, 63, 70, 0.9);
        --voca-ink: #f4f4f5;
        --voca-muted: #a1a1aa;
        --voca-accent: #3b82f6;
        --voca-accent-hover: #2563eb;
        --voca-toast-bg: rgba(9, 9, 11, 0.96);
        --voca-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
        --voca-shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      }
    }

    .voca-bubble {
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--voca-border);
      border-radius: 10px;
      background: var(--voca-bg);
      color: var(--voca-ink);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: var(--voca-shadow);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      opacity: 0;
      transform: scale(0.8);
      transform-origin: center;
      transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: auto;
    }

    .voca-bubble.voca-show {
      opacity: 1;
      transform: scale(1);
    }

    .voca-bubble-compact {
      padding: 4px 6px;
      gap: 6px;
      font-size: 12px;
    }

    .voca-bubble-label {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      padding: 0 4px;
    }

    .voca-bubble-btn {
      border: 0;
      border-radius: 6px;
      padding: 6px 10px;
      color: #ffffff;
      background: var(--voca-accent);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .voca-bubble-btn:hover {
      background: var(--voca-accent-hover);
      box-shadow: 0 4px 8px rgba(37, 99, 235, 0.2);
    }

    .voca-bubble-btn:active {
      transform: scale(0.96);
    }

    .voca-bubble-btn:disabled {
      background: var(--voca-muted);
      cursor: not-allowed;
      box-shadow: none;
    }

    .voca-bubble-btn-compact {
      width: 24px;
      height: 24px;
      padding: 0;
      font-size: 15px;
      font-weight: 700;
    }

    /* Progress Indicator in Bubble */
    [data-voca-progress] {
      display: none;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(37, 99, 235, 0.25);
      border-top-color: var(--voca-accent);
      border-radius: 50%;
      animation: vocaSpin 0.8s linear infinite;
      flex-shrink: 0;
    }

    /* Spinner anim */
    .voca-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: vocaSpin 0.8s linear infinite;
      flex-shrink: 0;
    }

    /* Toasts */
    .voca-toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 380px;
      min-width: 260px;
      padding: 12px 16px;
      border-radius: 10px;
      background: var(--voca-toast-bg);
      color: #ffffff;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      box-shadow: var(--voca-shadow-lg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      border: 1px solid rgba(255, 255, 255, 0.08);
      pointer-events: auto;
    }

    .voca-toast.voca-show {
      opacity: 1;
      transform: translateY(0);
    }

    .voca-toast-success {
      background: rgba(21, 128, 61, 0.95);
      border-color: rgba(34, 197, 94, 0.2);
    }

    .voca-toast-error {
      background: rgba(185, 28, 28, 0.95);
      border-color: rgba(239, 68, 68, 0.2);
    }

    .voca-toast-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      font-weight: 800;
      font-size: 11px;
      flex-shrink: 0;
    }

    .voca-toast-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex-grow: 1;
    }

    .voca-toast-title {
      font-weight: 700;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .voca-toast-text {
      font-weight: 500;
      font-size: 12px;
      opacity: 0.9;
      overflow-wrap: anywhere;
    }

    @keyframes vocaSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .voca-bubble, .voca-toast {
        transition: none !important;
      }
      [data-voca-progress], .voca-spinner {
        animation: none !important;
      }
    }
  `;
  document.documentElement.appendChild(style);
}
