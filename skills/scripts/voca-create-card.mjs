#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveRepoRoot(scriptDir) {
  const inferred = fs.existsSync(path.resolve(scriptDir, "..", "package.json"))
    ? path.resolve(scriptDir, "..")
    : path.resolve(scriptDir, "..", "..");
  const override = process.env.VOCA_REPO_ROOT?.trim();
  return override ? path.resolve(override) : inferred;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = resolveRepoRoot(SCRIPT_DIR);
const TMP_PLAYWRIGHT = process.env.VOCA_PLAYWRIGHT_HOME?.trim()
  ? path.resolve(process.env.VOCA_PLAYWRIGHT_HOME)
  : path.join(os.tmpdir(), "vocab-card-png");
const OUTPUT_DIR = process.env.VOCA_CARD_OUTPUT_DIR?.trim()
  ? path.resolve(process.env.VOCA_CARD_OUTPUT_DIR)
  : path.join(ROOT, ".voca-output", "vocabulary_cards");
const requireFromHere = createRequire(import.meta.url);
const entrySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "word",
    "pronunciation",
    "partOfSpeech",
    "topic",
    "frequency",
    "meaningEn",
    "meaningVi",
    "useCases",
    "examples",
    "memoryTip",
    "drawing",
    "toeicTrap",
    "practicePrompt",
    "answer",
  ],
  properties: {
    word: { type: "string" },
    pronunciation: { type: "string" },
    partOfSpeech: { type: "string" },
    topic: { type: "string" },
    frequency: { type: "string" },
    meaningEn: { type: "string" },
    meaningVi: { type: "string" },
    useCases: { type: "array", minItems: 3, maxItems: 4, items: { type: "string" } },
    examples: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
    memoryTip: { type: "string" },
    drawing: { type: "string" },
    toeicTrap: { type: "string" },
    practicePrompt: { type: "string" },
    answer: { type: "string" },
  },
};

function log(type, message, extra = {}) {
  console.log(JSON.stringify({ type, message, ...extra }));
}

function parseArgs(argv) {
  const words = argv
    .join(" ")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) {
    throw new Error("Usage: node skills/scripts/voca-create-card.mjs <word or phrase>[, second word]");
  }
  if (words.length > 3) {
    throw new Error("Voca supports 1-3 words per run.");
  }
  return words;
}

function augmentPath(platformPath) {
  if (process.platform === "win32") {
    return platformPath || "";
  }
  const extras = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...extras, platformPath || ""].filter(Boolean).join(path.delimiter);
}

function run(command, args, options = {}) {
  const shell = Boolean(options.shell);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell,
      env: {
        ...process.env,
        PATH: augmentPath(process.env.PATH),
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function ensurePlaywright() {
  const marker = path.join(TMP_PLAYWRIGHT, "node_modules", "playwright");
  if (fs.existsSync(marker)) {
    return;
  }
  fs.mkdirSync(TMP_PLAYWRIGHT, { recursive: true });
  log("progress", "Installing temporary Playwright runtime...");
  const useShell = process.platform === "win32";
  await run("npm", ["install", "--prefix", TMP_PLAYWRIGHT, "playwright"], { shell: useShell });
  await run("npx", ["--prefix", TMP_PLAYWRIGHT, "playwright", "install", "chromium"], { shell: useShell });
}

function escapeRawControlCharsInStrings(jsonStr) {
  let result = "";
  let inString = false;
  let isEscaped = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (char === '"' && !isEscaped) {
      inString = !inString;
      result += char;
    } else if (inString && (char === '\n' || char === '\r' || char === '\t')) {
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        if (jsonStr[i + 1] === '\n') {
          result += '\\n';
          i++;
        } else {
          result += '\\n';
        }
      } else if (char === '\t') {
        result += '\\t';
      }
    } else {
      result += char;
    }

    if (char === '\\' && inString) {
      isEscaped = !isEscaped;
    } else {
      isEscaped = false;
    }
  }
  return result;
}

function extractJson(text) {
  const sanitized = escapeRawControlCharsInStrings(text);
  let cleaned = sanitized.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    let start = -1;
    let end = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = cleaned.lastIndexOf("}");
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleaned.lastIndexOf("]");
    }
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (innerErr) {
        // Fall through
      }
    }
    throw err;
  }
}

function slugify(value) {
  return String(value || "word")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "word";
}

function compact(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function nowInVietnam() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}+07:00`;
}

function cleanTopic(value) {
  return compact(value).replace(/^TOEIC:\s*/i, "") || "General";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function list(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function visualParagraphs(value) {
  return escapeHtml(String(value ?? "").replace(/\\n/g, "\n").replace(/\\t/g, " ").trim())
    .replace(/\n/g, "<br>");
}

function cardHtml(entry) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { --ink:#1f2933; --muted:#64748b; --line:#d8dee6; --soft:#f6f8fb; --blue:#1d4ed8; --green:#e9f8f1; --orange:#fff7ed; }
  * { box-sizing:border-box; }
  body { margin:0; background:#fff; color:var(--ink); font-family:Arial, Helvetica, sans-serif; line-height:1.45; }
  .page { width:794px; min-height:1123px; padding:54px; background:#fff; }
  header { display:grid; grid-template-columns:1fr 230px; gap:18px; align-items:start; padding-bottom:18px; border-bottom:3px solid var(--ink); }
  .label { margin:0 0 8px; color:var(--muted); font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  h1 { margin:0; color:var(--blue); font-size:56px; line-height:1; overflow-wrap:anywhere; }
  .pronunciation { margin-top:10px; color:var(--muted); font-size:17px; font-weight:700; }
  .meta { display:grid; gap:8px; }
  .pill { display:flex; align-items:center; justify-content:center; min-height:30px; padding:5px 10px; border:1px solid #b8c8ee; border-radius:999px; background:#eaf1ff; color:#183b7a; font-size:12px; font-weight:700; text-align:center; }
  .date-line { height:28px; border-bottom:1px solid var(--line); color:var(--muted); font-size:12px; }
  .main-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:14px; margin-top:18px; }
  .section-stack { display:grid; gap:12px; }
  .box { padding:13px; border:1px solid var(--line); border-radius:8px; background:#fff; }
  .soft { background:var(--soft); }
  .green { background:var(--green); border-color:#a7dfc1; }
  .orange { background:var(--orange); border-color:#fed7aa; }
  h2 { margin:0 0 8px; color:var(--blue); font-size:14px; letter-spacing:.04em; text-transform:uppercase; }
  p { margin:0 0 7px; font-size:15px; }
  ul { margin:0; padding-left:20px; font-size:15px; }
  li { margin:5px 0; }
  .vn { color:var(--muted); font-style:italic; }
  .memory-drawing { display:grid; place-items:center; min-height:160px; margin-top:8px; border:2px dashed #f6b64b; border-radius:8px; background:#fffdf8; color:#b45309; font-size:30px; font-weight:800; text-align:center; white-space:pre-line; }
  .practice-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
  .line-area { min-height:132px; background-image:linear-gradient(to bottom, transparent 25px, var(--line) 26px); background-size:100% 26px; }
  .footer-review { margin-top:14px; padding:12px; border:2px solid var(--ink); border-radius:8px; }
  .big-note { min-height:164px; background-image:linear-gradient(to bottom, transparent 27px, var(--line) 28px); background-size:100% 28px; }
  .answer-line { display:inline-block; min-width:170px; border-bottom:1px solid var(--ink); transform:translateY(-2px); }
</style>
</head>
<body>
<section class="page">
  <header>
    <div>
      <p class="label">Vocabulary Focus</p>
      <h1>${escapeHtml(entry.word)}</h1>
      <div class="pronunciation">${escapeHtml(entry.pronunciation)}</div>
    </div>
    <div class="meta">
      <span class="pill">${escapeHtml(entry.partOfSpeech)}</span>
      <span class="pill">${escapeHtml(entry.topic)}</span>
      <span class="pill">${escapeHtml(entry.frequency)}</span>
      <div class="date-line">Date:</div>
    </div>
  </header>
  <div class="main-grid">
    <div class="section-stack">
      <section class="box green"><h2>1. Meaning</h2><p><strong>Simple English:</strong> ${escapeHtml(entry.meaningEn)}</p><p class="vn"><strong>Tiếng Việt:</strong> ${escapeHtml(entry.meaningVi)}</p></section>
      <section class="box"><h2>2. Common Use Cases</h2><ul>${list(entry.useCases)}</ul></section>
      <section class="box"><h2>3. Examples</h2><ul>${list(entry.examples)}</ul></section>
    </div>
    <div class="section-stack">
      <section class="box orange"><h2>4. Memory Tip</h2><p>${escapeHtml(entry.memoryTip)}</p><div class="memory-drawing">${visualParagraphs(entry.drawing)}</div></section>
      <section class="box soft"><h2>5. TOEIC Trap</h2><p>${escapeHtml(entry.toeicTrap)}</p></section>
    </div>
  </div>
  <div class="practice-grid">
    <section class="box"><h2>Mini Practice</h2><p>${escapeHtml(entry.practicePrompt).replace("______", '<span class="answer-line"></span>')}</p><p><strong>Answer:</strong> ${escapeHtml(entry.answer)}</p></section>
    <section class="box"><h2>My Sentence</h2><div class="line-area"></div></section>
  </div>
  <section class="footer-review"><h2>Quick Review</h2><div class="big-note"></div></section>
</section>
</body>
</html>`;
}

async function renderCards(entries, outputDir) {
  const playwrightPath = path.join(TMP_PLAYWRIGHT, "node_modules", "playwright");
  const { chromium } = requireFromHere(playwrightPath);
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 794, height: 1123 },
    deviceScaleFactor: 2,
  });
  const generated = [];
  try {
    for (const entry of entries) {
      await page.setContent(cardHtml(entry), { waitUntil: "networkidle" });
      const outputPath = path.join(outputDir, `${slugify(entry.word)}.png`);
      await page.locator(".page").screenshot({ path: outputPath });
      generated.push(outputPath);
    }
  } finally {
    await browser.close();
  }
  return generated;
}

function manifestEntry(entry, filename) {
  const topic = cleanTopic(entry.topic);
  const pos = compact(entry.partOfSpeech).split("/")[0].trim();
  const item = {
    word: compact(entry.word),
    file: filename,
    partOfSpeech: compact(entry.partOfSpeech) || "unknown",
    topic,
    frequency: compact(entry.frequency),
    meaningEn: compact(entry.meaningEn),
    meaningVi: compact(entry.meaningVi),
    useCases: Array.isArray(entry.useCases) ? entry.useCases.map(compact).filter(Boolean).slice(0, 4) : [],
    examples: Array.isArray(entry.examples) ? entry.examples.map(compact).filter(Boolean).slice(0, 3) : [],
    memoryTip: compact(entry.memoryTip),
    toeicTrap: compact(entry.toeicTrap),
    practicePrompt: compact(entry.practicePrompt),
    answer: compact(entry.answer),
    tags: [topic.toLowerCase(), pos.toLowerCase(), "custom"].filter(Boolean),
    createdAt: compact(entry.createdAt || entry.created_at) || nowInVietnam(),
    level: ["new", "learning", "known", "mastered"].includes(compact(entry.level).toLowerCase())
      ? compact(entry.level).toLowerCase()
      : "new",
  };
  if (process.env.VOCA_KEYWORD) {
    item.keyword = process.env.VOCA_KEYWORD;
  }
  const pronunciation = compact(entry.pronunciation || entry.ipa || entry.IPA);
  if (pronunciation) {
    item.pronunciation = pronunciation;
  }
  return item;
}

function createdAtRank(entry) {
  const timestamp = Date.parse(entry.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, data, "utf8");
  fs.renameSync(tempPath, filePath);
}

function syncDictionary(entries, pngDir, dictionaryDir) {
  const dictionaryCardsDir = path.join(dictionaryDir, "cards");
  const manifestPath = path.join(dictionaryDir, "cards.json");
  if (!fs.existsSync(manifestPath)) {
    writeJsonAtomic(manifestPath, "[]\n");
  }
  fs.mkdirSync(dictionaryCardsDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const seenWords = new Set(manifest.map((item) => compact(item.word).toLowerCase()));
  const seenFiles = new Set(manifest.map((item) => compact(item.file).toLowerCase()));
  const seenSlugs = new Set(manifest.map((item) => slugify(item.word || item.file)));
  const copied = [];
  const skipped = [];

  for (const entry of entries) {
    const word = compact(entry.word);
    const slug = slugify(word);
    const filename = `${slug}.png`;
    const sourcePng = path.join(pngDir, filename);
    const targetPng = path.join(dictionaryCardsDir, filename);
    const duplicate = seenWords.has(word.toLowerCase())
      || seenFiles.has(filename.toLowerCase())
      || seenSlugs.has(slug)
      || fs.existsSync(targetPng);
    if (duplicate) {
      skipped.push({ word, file: filename, reason: "already exists" });
      continue;
    }
    if (!fs.existsSync(sourcePng)) {
      skipped.push({ word, file: filename, reason: "png missing" });
      continue;
    }
    fs.writeFileSync(targetPng, fs.readFileSync(sourcePng));
    try {
      fs.chmodSync(targetPng, 0o644);
    } catch {
      /* chmod optional on Windows */
    }
    manifest.push(manifestEntry(entry, filename));
    seenWords.add(word.toLowerCase());
    seenFiles.add(filename.toLowerCase());
    seenSlugs.add(slug);
    copied.push({ word, file: filename });
  }
  if (copied.length) {
    manifest.sort(
      (a, b) =>
        createdAtRank(b) - createdAtRank(a)
        || String(a.word || "").localeCompare(String(b.word || "")),
    );
    writeJsonAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { dictionaryDir, copied, skipped, manifestTotal: manifest.length };
}

function validateEntries(entries, requestedWords) {
  if (!Array.isArray(entries) || entries.length !== requestedWords.length) {
    throw new Error("Generated data must be a JSON array with one entry per requested word.");
  }
  const required = [
    "word",
    "pronunciation",
    "partOfSpeech",
    "topic",
    "frequency",
    "meaningEn",
    "meaningVi",
    "useCases",
    "examples",
    "memoryTip",
    "drawing",
    "toeicTrap",
    "practicePrompt",
    "answer",
  ];
  for (const entry of entries) {
    for (const key of required) {
      if (!(key in entry)) {
        throw new Error(`Generated entry for ${entry.word || "unknown"} is missing ${key}.`);
      }
    }
  }
}

async function generateWithOpenAI(words) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to ~/.voca-menubar.env or the launch environment.");
  }

  log("progress", `Generating vocabulary data with ${model}...`);
  const prompt = `Create compact TOEIC-focused bilingual vocabulary card data for these words/phrases: ${words.join(", ")}.

Return only a JSON array. Each item must contain:
word, pronunciation, partOfSpeech, topic, frequency, meaningEn, meaningVi, useCases, examples, memoryTip, drawing, toeicTrap, practicePrompt, answer.

Rules:
- You MUST return exactly ${words.length} entries in the array.
- Each entry in the JSON array must correspond exactly to one of the requested words/phrases in the list (in the same order: ${words.map(w => `"${w}"`).join(", ")}). Do not split a phrase (like "${words.join(", ")}") into multiple separate word entries.
- Simple English first, Vietnamese second.
- Keep explanations compact and practical.
- Include 3-4 collocations/use cases.
- Include 2-3 natural examples.
- drawing must use plain printable text (use \n for newlines; do not output raw literal newlines inside JSON strings).
- If a requested word appears misspelled, use the correct spelling as word and mention the spelling trap in toeicTrap.`;

  const payload = await requestModel(apiKey, prompt, words);
  const text = payload.output_text
    || payload.output?.flatMap((item) => item.content || [])
      .map((content) => content.text || "")
      .join("")
    || payload.choices?.[0]?.message?.content
    || "";
  const parsed = extractJson(text);
  let entries = Array.isArray(parsed) ? parsed : parsed.entries || parsed.words || parsed.cards;
  if (!entries && parsed && typeof parsed === "object" && parsed.word) {
    entries = [parsed];
  }
  validateEntries(entries, words);
  return entries;
}

async function requestModel(apiKey, prompt, words) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const baseURL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const responsesBody = {
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "voca_cards",
        strict: true,
        schema: responseSchema(words.length),
      },
    },
  };

  try {
    return await requestJson(`${baseURL}/responses`, apiKey, responsesBody);
  } catch (error) {
    if (baseURL.includes("api.openai.com")) {
      throw error;
    }
    log("log", "Responses API unavailable; trying chat completions...");
  }

  const chatBody = {
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content: "Return only valid JSON matching the requested schema.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "voca_cards",
        strict: true,
        schema: responseSchema(words.length),
      },
    },
  };

  try {
    return await requestJson(`${baseURL}/chat/completions`, apiKey, chatBody);
  } catch (error) {
    log("log", "JSON schema chat failed; trying plain JSON mode...");
  }

  return await requestJson(`${baseURL}/chat/completions`, apiKey, {
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content: "Return only valid JSON. No markdown, no explanation.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: { type: "json_object" },
  });
}

function responseSchema(count) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["entries"],
    properties: {
      entries: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: entrySchema,
      },
    },
  };
}

async function requestJson(url, apiKey, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`API request could not reach ${url}: ${message}`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.trim().slice(0, 240);
    throw new Error(
      preview
        ? `API returned non-JSON response from ${url}: ${preview}`
        : `API returned an empty response from ${url}`,
    );
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || `API request failed with status ${response.status}`);
  }
  return payload;
}

function loadEnvFile() {
  const envPath = path.join(os.homedir(), ".voca-menubar.env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function createCardRemotely(apiUrl, words) {
  const token = process.env.VOCA_API_TOKEN || "";
  const baseURL = process.env.OPENAI_BASE_URL || "";
  const apiKey = process.env.OPENAI_API_KEY || "";
  const model = process.env.OPENAI_MODEL || "";

  log("progress", `Connecting to remote bridge at ${apiUrl}...`);

  const url = apiUrl.replace(/\/+$/, "") + "/create-card";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      word: words.join(", "),
      settings: {
        baseURL,
        apiKey,
        model
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Remote bridge error (${response.status}): ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      let isError = false;
      let errMsg = "";
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === "error") {
          isError = true;
          errMsg = parsed.message || "Unknown remote bridge error";
        }
      } catch {}
      
      if (isError) {
        throw new Error(errMsg);
      } else {
        console.log(trimmed);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    let isError = false;
    let errMsg = "";
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === "error") {
        isError = true;
        errMsg = parsed.message || "Unknown remote bridge error";
      }
    } catch {}
    
    if (isError) {
      throw new Error(errMsg);
    } else {
      console.log(trimmed);
    }
  }
}

async function main() {
  loadEnvFile();
  const words = parseArgs(process.argv.slice(2));

  const runLocal = process.env.VOCA_RUN_LOCAL_BRIDGE !== "0";
  const apiUrl = process.env.VOCA_API_URL?.trim();
  if (!runLocal && apiUrl) {
    await createCardRemotely(apiUrl, words);
    return;
  }

  log("progress", `Preparing ${words.join(", ")}...`);
  await ensurePlaywright();

  const entries = await generateWithOpenAI(words);
  log("progress", "Rendering PNG card(s)...");
  const generated = await renderCards(entries, OUTPUT_DIR);
  for (const file of generated) {
    log("progress", `Rendered ${path.basename(file)}`);
  }

  log("progress", "Syncing voca-dictionary...");
  const syncResult = syncDictionary(entries, OUTPUT_DIR, ROOT);
  log("done", "Completed", {
    outputDir: OUTPUT_DIR,
    copied: syncResult.copied,
    skipped: syncResult.skipped,
  });
}

main().catch((error) => {
  log("error", error.message || String(error));
  process.exit(1);
});
