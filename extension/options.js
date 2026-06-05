const DEFAULT_SETTINGS = {
  apiPort: "22053",
  baseURL: "",
  apiKey: "",
  model: "",
  showBubble: true,
  showToasts: true,
};

const form = document.querySelector("#settings-form");
const statusEl = document.querySelector("#status");
const testBtn = document.querySelector("#test-btn");
const testStatusEl = document.querySelector("#test-status");

// Load on start
loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving...", "testing");

  const formData = new FormData(form);
  const settings = {
    apiPort: cleanPort(formData.get("apiPort")),
    baseURL: cleanURL(formData.get("baseURL"), ""),
    apiKey: String(formData.get("apiKey") || "").trim(),
    model: String(formData.get("model") || "").trim(),
    showBubble: form.querySelector("#showBubble").checked,
    showToasts: form.querySelector("#showToasts").checked,
  };

  await chrome.storage.local.set(settings);
  setStatus("Settings saved successfully.", "success");
  
  // Hide success message after 3 seconds
  setTimeout(() => {
    statusEl.style.display = "none";
  }, 3000);
});

testBtn.addEventListener("click", async () => {
  const port = cleanPort(form.querySelector("#apiPort").value);
  setTestStatus("Testing local bridge...", "testing");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    // We fetch the API root. It returns 404 or similar, but connecting successfully verifies the server is listening.
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "GET",
      mode: "no-cors", // avoid CORS issues with browser sandbox
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    setTestStatus("Bridge is running and reachable!", "success");
  } catch (err) {
    clearTimeout(timeoutId);
    setTestStatus("Cannot reach local bridge. Is npm run voca:api running?", "error");
  }
});

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  for (const [key, value] of Object.entries(merged)) {
    const element = form.elements.namedItem(key);
    if (!element) continue;

    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else {
      element.value = String(value || "");
    }
  }
}

function setStatus(message, className = "") {
  statusEl.textContent = message;
  statusEl.className = className;
  statusEl.style.display = message ? "inline-block" : "none";
}

function setTestStatus(message, className = "") {
  testStatusEl.textContent = message;
  testStatusEl.className = className;
  testStatusEl.style.display = message ? "inline-block" : "none";
}

function cleanPort(value) {
  const port = String(value || DEFAULT_SETTINGS.apiPort).trim();
  return /^\d{2,5}$/.test(port) ? port : DEFAULT_SETTINGS.apiPort;
}

function cleanURL(value, fallback) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  return url || fallback;
}
