const form = document.querySelector("#add-form");
const wordInput = document.querySelector("#word");
const statusEl = document.querySelector("#status");
const optionsButton = document.querySelector("#options");
const addButton = document.querySelector("#add");
const spinnerEl = addButton.querySelector(".spinner");
const btnTextEl = addButton.querySelector(".btn-text");
const contextSourceEl = document.querySelector("#context-source");

// Initial load
hydrateWord();
hydrateSourceContext();

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const word = cleanWord(wordInput.value);
  if (!word) {
    setStatus("Enter a word first.", "error");
    return;
  }

  setPending(true);
  setStatus("Creating card...");
  const response = await sendAddWord(word);
  setPending(false);

  if (response?.ok) {
    setStatus(`Added "${word}".`, "success");
  } else {
    setStatus(response?.error || "Cannot add word.", "error");
  }
});

async function hydrateWord() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "voca:get-word" });
    const word = cleanWord(response?.word);
    if (word) {
      wordInput.value = word;
      wordInput.select();
    } else {
      wordInput.focus();
    }
  } catch {
    wordInput.focus();
  }
}

async function hydrateSourceContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  try {
    const urlObj = new URL(tab.url);
    const hostname = urlObj.hostname.replace(/^www\./, "");
    // Ignore internal pages
    if (hostname && hostname !== "newtab" && hostname !== "extensions" && !hostname.startsWith("chrome")) {
      contextSourceEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
        <span>From ${hostname}</span>
      `;
      contextSourceEl.style.display = "inline-flex";
    }
  } catch (e) {
    console.error("Failed to parse tab source url:", e);
  }
}

async function sendAddWord(word) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return await chrome.runtime.sendMessage({ type: "voca:add-word", word, tabId: tab?.id });
  } catch (error) {
    const raw = error?.message || String(error || "");
    return {
      ok: false,
      error: raw.includes("Extension context invalidated")
        ? "Extension reloaded. Refresh the tab and try again."
        : raw || "Cannot contact Voca extension.",
    };
  }
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = ""; // clear all classes
  if (type) {
    statusEl.classList.add(type);
  }
}

function setPending(pending) {
  addButton.disabled = pending;
  if (pending) {
    spinnerEl.style.display = "inline-block";
    btnTextEl.textContent = "Adding...";
    addButton.querySelector(".btn-icon").style.display = "none";
  } else {
    spinnerEl.style.display = "none";
    btnTextEl.textContent = "Add word";
    addButton.querySelector(".btn-icon").style.display = "inline-block";
  }
}

function cleanWord(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim()
    .slice(0, 120);
}


