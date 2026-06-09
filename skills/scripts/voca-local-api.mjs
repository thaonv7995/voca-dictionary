#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

function resolveRepoRoot(scriptDir) {
  const inferred = fsSync.existsSync(path.resolve(scriptDir, "..", "package.json"))
    ? path.resolve(scriptDir, "..")
    : path.resolve(scriptDir, "..", "..");
  const override = process.env.VOCA_REPO_ROOT?.trim();
  return override ? path.resolve(override) : inferred;
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = resolveRepoRoot(SCRIPT_DIR);
const BIND_HOST = process.env.VOCA_BIND_ADDRESS?.trim() || "127.0.0.1";
const AUDIO_DIR = path.join(ROOT, "audio");
const CARDS_DIR = path.join(ROOT, "cards");
const MANIFEST_PATH = path.join(ROOT, "cards.json");
const OUTPUT_DIR = path.join(ROOT, ".voca-output");
const PRACTICE_ATTEMPTS_PATH = path.join(OUTPUT_DIR, "mobile-practice-attempts.jsonl");
const CREATE_CARD_SCRIPT = path.join(SCRIPT_DIR, "voca-create-card.mjs");
const CONFIG_PATH = path.join(ROOT, "voca-config.json");
const PORT = Number(process.env.VOCA_LOCAL_API_PORT || 22053);
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_VOCA_API_TOKEN = readSharedDefaultVocaApiToken();
const VOCA_API_TOKENS = String(process.env.VOCA_API_TOKEN || process.env.VOCA_API_TOKENS || DEFAULT_VOCA_API_TOKEN)
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);
const BASE_ALLOWED_ORIGINS = [
  "https://voca.thaonv.online",
  "http://localhost:22052",
  "http://127.0.0.1:22052",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];
const EXTRA_ALLOWED_ORIGINS = String(process.env.VOCA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...BASE_ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);
const DOCKER_HOSTNAME = process.env.VOCA_DOCKER_HOSTNAME?.trim() || "host.docker.internal";
const IS_DOCKER_RUNTIME =
  process.env.VOCA_FORCE_DOCKER_HOST_REWRITE === "1" ||
  process.env.VOCA_REPO_ROOT === "/voca-data" ||
  fsSync.existsSync("/.dockerenv");

function readSharedDefaultVocaApiToken() {
  const candidates = [
    path.join(ROOT, "packages/voca-core/src/auth/token.ts"),
    path.resolve(SCRIPT_DIR, "../../packages/voca-core/src/auth/token.ts"),
  ];
  for (const candidate of candidates) {
    try {
      const content = fsSync.readFileSync(candidate, "utf8");
      const match = content.match(/DEFAULT_VOCA_API_TOKEN\s*=\s*"([^"]+)"/);
      if (match?.[1]?.trim()) return match[1].trim();
    } catch {
      // Fall through to the committed fallback below.
    }
  }
  return "voca_55c2ac41266be58e43d0ef2b5817b4c9053a2ed7410fcefd";
}

function isResolvedPathInsideDirectory(directory, resolvedCandidate) {
  const base = path.resolve(directory);
  const resolved = path.resolve(resolvedCandidate);
  const relative = path.relative(base, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sendJson(request, response, status, payload) {
  const requestOrigin = request.headers.origin;
  const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "http://localhost:22052";
  response.writeHead(status, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, PATCH, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendBinary(request, response, status, payload, contentType = "application/octet-stream") {
  const requestOrigin = request.headers.origin;
  const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "http://localhost:22052";
  response.writeHead(status, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": contentType,
  });
  response.end(payload);
}

function streamHeaders(request, response) {
  const requestOrigin = request.headers.origin;
  const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "http://localhost:22052";
  response.writeHead(200, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/x-ndjson; charset=utf-8",
  });
}

function writeEvent(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

function apiError(code, message, details = {}) {
  return { error: { code, message, details } };
}

function sendApiError(request, response, status, code, message, details) {
  sendJson(request, response, status, apiError(code, message, details));
}

/** Strip trailing slashes so /v1/health/ matches /v1/health (some clients add a slash). */
function normalizedPathname(url) {
  let pathname = decodeURIComponent(url.pathname);
  while (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return pathname;
}

function hasValidVocaApiToken(request) {
  if (!VOCA_API_TOKENS.length) return true;
  const authorization = String(request.headers.authorization || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return Boolean(match && VOCA_API_TOKENS.includes(match[1].trim()));
}

function requireVocaApiToken(request, response) {
  if (hasValidVocaApiToken(request)) return true;
  sendApiError(request, response, 401, "UNAUTHORIZED", "Missing or invalid Voca API token.");
  return false;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeWord(value) {
  return String(value || "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
}

function safeSegment(value) {
  return String(value || "default")
    .trim()
    .replace(/^edge-tts\//, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "default";
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "word";
}

function rewriteLoopbackUrlForDocker(value) {
  if (!IS_DOCKER_RUNTIME || !value) return value;
  try {
    const url = new URL(value);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") {
      url.hostname = DOCKER_HOSTNAME;
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    return value;
  }
  return value;
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

function normalizeOutboundSettings(settings) {
  return {
    ...settings,
    baseURL: rewriteLoopbackUrlForDocker(settings.baseURL),
    ttsEndpoint: rewriteLoopbackUrlForDocker(settings.ttsEndpoint),
  };
}

function audioCachePath({ text, voiceModel }) {
  const voice = safeSegment(voiceModel);
  const hash = crypto.createHash("sha256").update(`${voiceModel}\n${text}`).digest("hex").slice(0, 16);
  const readable = safeSegment(text).slice(0, 48) || "speech";
  const relativePath = `/audio/${voice}/${readable}-${hash}.mp3`;
  return {
    relativePath,
    filePath: path.join(AUDIO_DIR, voice, `${readable}-${hash}.mp3`),
  };
}

class ConcurrencyLimiter {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.activeCount = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

const maxConcurrency = Number(process.env.VOCA_MAX_CONCURRENCY || 2);
const createCardLimiter = new ConcurrencyLimiter(maxConcurrency);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readServerConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeServerConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

async function readManifestFile() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const cards = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.cards) ? parsed.cards : null;
    if (!cards) throw new Error("cards.json must be either an array or an object with a cards array.");
    validateManifestCards(cards);
    const stat = await fs.stat(MANIFEST_PATH);
    const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    return {
      cards,
      raw,
      manifestVersion: `cards:${Math.trunc(stat.mtimeMs)}:${hash}`,
      source: Array.isArray(parsed) ? "legacy" : "versioned",
      version: parsed?.version || undefined,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        cards: [],
        raw: "[]",
        manifestVersion: "cards:missing:empty",
        source: "legacy",
        version: undefined,
      };
    }
    throw error;
  }
}

function validateManifestCards(cards) {
  cards.forEach((card, index) => {
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      throw new Error(`cards.json entry ${index} must be an object.`);
    }
    if (!String(card.word || "").trim()) {
      throw new Error(`cards.json entry ${index} is missing word.`);
    }
    if (!String(card.file || "").trim()) {
      throw new Error(`cards.json entry ${index} is missing file.`);
    }
    if (card.level && !["new", "learning", "known", "mastered"].includes(card.level)) {
      throw new Error(`cards.json entry ${index} has invalid level.`);
    }
    if (card.tags && !Array.isArray(card.tags)) {
      throw new Error(`cards.json entry ${index} tags must be an array.`);
    }
  });
}

function normalizeManifestCard(card) {
  const word = String(card.word || "").trim();
  const slug = card.slug || slugify(word);
  const id = slug;
  const file = String(card.file || `${slug}.png`);
  return {
    ...card,
    id,
    word,
    slug,
    file,
    tags: Array.isArray(card.tags) ? card.tags : [],
    partOfSpeech: card.partOfSpeech || "unknown",
    topic: card.topic || "uncategorized",
    level: ["new", "learning", "known", "mastered"].includes(card.level) ? card.level : "new",
    imageUrl: `/v1/assets/cards/${encodeURIComponent(file)}`,
    audioUrl: `/v1/audio/${encodeURIComponent(id)}`,
  };
}

async function readNormalizedManifest() {
  const manifest = await readManifestFile();
  return {
    ...manifest,
    cards: manifest.cards.map(normalizeManifestCard),
  };
}

async function writeManifestCards(cards) {
  validateManifestCards(cards);
  const tmpPath = `${MANIFEST_PATH}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(cards, null, 2)}\n`;
  await fs.writeFile(tmpPath, payload, "utf8");
  await fs.rename(tmpPath, MANIFEST_PATH);
}

async function findCardById(cardId) {
  const manifest = await readNormalizedManifest();
  const normalized = slugify(cardId);
  const card = manifest.cards.find(
    (item) => item.id === cardId || item.slug === cardId || item.slug === normalized || item.word.toLowerCase() === String(cardId).toLowerCase(),
  );
  return { manifest, card };
}

async function findCachedAudioForCard(card) {
  const readable = safeSegment(card.word).slice(0, 48);
  const matches = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile() && entry.name.endsWith(".mp3") && entry.name.startsWith(readable)) {
        const stat = await fs.stat(filePath);
        matches.push({ filePath, mtimeMs: stat.mtimeMs });
      }
    }
  }
  await walk(AUDIO_DIR);
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.filePath || null;
}

function serverTtsSettings() {
  const apiKey = process.env.VOCA_TTS_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseURL = process.env.VOCA_TTS_BASE_URL || process.env.OPENAI_BASE_URL || "";
  const ttsEndpoint = process.env.VOCA_TTS_ENDPOINT || "";
  const ttsModel = process.env.VOCA_TTS_MODEL || "edge-tts/en-US-SteffanNeural";
  return { apiKey, baseURL, ttsEndpoint, ttsModel };
}

function serverLlmSettings() {
  return {
    apiKey: process.env.VOCA_LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    baseURL: process.env.VOCA_LLM_BASE_URL || process.env.OPENAI_BASE_URL || "",
    model: process.env.VOCA_LLM_MODEL || process.env.OPENAI_MODEL || "",
  };
}

async function generateTtsAudio({ text, settings }) {
  const outboundSettings = normalizeOutboundSettings(settings);
  const endpoint =
    outboundSettings.ttsEndpoint || `${String(outboundSettings.baseURL || "").replace(/\/+$/, "")}/audio/speech`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${outboundSettings.apiKey}`,
    },
    body: JSON.stringify({
      model: outboundSettings.ttsModel || "edge-tts/en-US-SteffanNeural",
      input: text,
    }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`TTS request failed (${response.status})${message ? `: ${message.slice(0, 160)}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function handleTtsCache(request, response) {
  const body = JSON.parse(await readBody(request));
  const text = String(body.text || "").trim();
  const settings = body.settings || {};
  if (!text) throw new Error("Missing text.");
  if (!settings.apiKey || !(settings.ttsEndpoint || settings.baseURL)) {
    throw new Error("Missing voice settings.");
  }

  const voiceModel = settings.ttsModel || "edge-tts/en-US-SteffanNeural";
  const { filePath, relativePath } = audioCachePath({ text, voiceModel });
  if (await fileExists(filePath)) {
    sendJson(request, response, 200, { audioUrl: relativePath, cached: true });
    return;
  }

  const audio = await generateTtsAudio({ text, settings: { ...settings, ttsModel: voiceModel } });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, audio);
  sendJson(request, response, 200, { audioUrl: relativePath, cached: false });
}

async function handleAudioFile(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const requestedPath = decodeURIComponent(url.pathname.replace(/^\/audio\//, ""));
  const filePath = path.resolve(AUDIO_DIR, requestedPath);
  if (!filePath.endsWith(".mp3") || !isResolvedPathInsideDirectory(AUDIO_DIR, filePath)) {
    sendJson(request, response, 404, { error: "Not found" });
    return;
  }
  if (!fsSync.existsSync(filePath)) {
    sendJson(request, response, 404, { error: "Not found" });
    return;
  }
  sendBinary(request, response, 200, await fs.readFile(filePath), "audio/mpeg");
}

async function handleV1Health(request, response) {
  const llmSettings = serverLlmSettings();
  const ttsSettings = serverTtsSettings();
  sendJson(request, response, 200, {
    ok: true,
    service: "voca-api",
    storage: "file-backed",
    authConfigured: VOCA_API_TOKENS.length > 0,
    llmConfigured: Boolean(llmSettings.apiKey && llmSettings.baseURL && llmSettings.model),
    ttsConfigured: Boolean(ttsSettings.apiKey && (ttsSettings.ttsEndpoint || ttsSettings.baseURL)),
  });
}

async function handleV1Bootstrap(request, response) {
  const manifest = await readNormalizedManifest();
  sendJson(request, response, 200, {
    service: "voca-api",
    storage: "file-backed",
    manifestVersion: manifest.manifestVersion,
    version: manifest.version,
    source: manifest.source,
    cards: manifest.cards,
    assets: {
      cardsBaseUrl: "/v1/assets/cards",
      audioBaseUrl: "/v1/audio",
    },
    features: {
      createCard: true,
      ttsCache: true,
      streamingAgents: true,
    },
  });
}

async function handleV1Cards(request, response, url) {
  const manifest = await readNormalizedManifest();
  const ifChangedSince = url.searchParams.get("ifChangedSince");
  if (ifChangedSince && ifChangedSince === manifest.manifestVersion) {
    sendJson(request, response, 200, {
      status: "not_modified",
      manifestVersion: manifest.manifestVersion,
    });
    return;
  }
  sendJson(request, response, 200, {
    version: manifest.version,
    manifestVersion: manifest.manifestVersion,
    source: manifest.source,
    cards: manifest.cards,
  });
}

async function handleV1CardById(request, response, cardId) {
  const { manifest, card } = await findCardById(cardId);
  if (!card) {
    sendApiError(request, response, 404, "CARD_NOT_FOUND", "Card not found.", { id: cardId });
    return;
  }
  sendJson(request, response, 200, { manifestVersion: manifest.manifestVersion, card });
}

async function handleV1PatchCardLevel(request, response, cardId) {
  const body = JSON.parse(await readBody(request));
  const level = String(body.level || "");
  if (!["new", "learning", "known", "mastered"].includes(level)) {
    sendApiError(request, response, 400, "INVALID_CARD_LEVEL", "Card level must be new, learning, known, or mastered.", { level });
    return;
  }
  const manifest = await readManifestFile();
  const normalized = slugify(cardId);
  const index = manifest.cards.findIndex((item) => {
    const card = normalizeManifestCard(item);
    return card.id === cardId || card.slug === cardId || card.slug === normalized || card.word.toLowerCase() === String(cardId).toLowerCase();
  });
  if (index < 0) {
    sendApiError(request, response, 404, "CARD_NOT_FOUND", "Card not found.", { id: cardId });
    return;
  }
  manifest.cards[index] = { ...manifest.cards[index], level };
  await writeManifestCards(manifest.cards);
  const updated = await readNormalizedManifest();
  const card = updated.cards.find((item) => item.id === normalizeManifestCard(manifest.cards[index]).id);
  sendJson(request, response, 200, { manifestVersion: updated.manifestVersion, card });
}

async function deleteCachedAudioForCard(card) {
  const readable = safeSegment(card.word).slice(0, 48);
  if (!readable) return;
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (entry.isFile() && entry.name.endsWith(".mp3") && (entry.name.startsWith(`${readable}-`) || entry.name === `${readable}.mp3`)) {
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.warn(`[voca] Failed to delete audio file: ${filePath}`, err);
        }
      }
    }
  }
  await walk(AUDIO_DIR);
}

async function handleV1DeleteCard(request, response, cardId) {
  const manifest = await readManifestFile();
  const normalized = slugify(cardId);
  const index = manifest.cards.findIndex((item) => {
    const card = normalizeManifestCard(item);
    return card.id === cardId || card.slug === cardId || card.slug === normalized || card.word.toLowerCase() === String(cardId).toLowerCase();
  });
  if (index < 0) {
    sendApiError(request, response, 404, "CARD_NOT_FOUND", "Card not found.", { id: cardId });
    return;
  }
  const deletedCard = normalizeManifestCard(manifest.cards[index]);
  
  // Remove from array
  manifest.cards.splice(index, 1);
  await writeManifestCards(manifest.cards);
  
  // Clean up image file
  if (deletedCard.file) {
    const imgPath = path.resolve(CARDS_DIR, deletedCard.file);
    if (isResolvedPathInsideDirectory(CARDS_DIR, imgPath)) {
      try {
        if (fsSync.existsSync(imgPath)) {
          await fs.unlink(imgPath);
        }
      } catch (err) {
        console.warn(`[voca] Failed to delete card image: ${imgPath}`, err);
      }
    }
  }
  
  // Clean up audio files
  await deleteCachedAudioForCard(deletedCard);
  
  const updated = await readNormalizedManifest();
  sendJson(request, response, 200, { manifestVersion: updated.manifestVersion, success: true });
}

async function clearAllCardImages() {
  let entries;
  try {
    entries = await fs.readdir(CARDS_DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".png")) {
      const filePath = path.join(CARDS_DIR, entry.name);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.warn(`[voca] Failed to delete card image: ${filePath}`, err);
      }
    }
  }
}

async function clearAllCachedAudio() {
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
        try {
          const subEntries = await fs.readdir(filePath);
          if (subEntries.length === 0) {
            await fs.rmdir(filePath);
          }
        } catch {}
      } else if (entry.isFile() && entry.name.endsWith(".mp3")) {
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.warn(`[voca] Failed to delete audio: ${filePath}`, err);
        }
      }
    }
  }
  await walk(AUDIO_DIR);
}

async function handleV1ClearAllCards(request, response) {
  // Empty manifest
  await writeManifestCards([]);
  
  // Delete all image and audio files
  await clearAllCardImages();
  await clearAllCachedAudio();
  
  const updated = await readNormalizedManifest();
  sendJson(request, response, 200, { manifestVersion: updated.manifestVersion, success: true });
}


async function handleV1CardAsset(request, response, file) {
  const filePath = path.resolve(CARDS_DIR, file);
  if (!filePath.endsWith(".png") || !isResolvedPathInsideDirectory(CARDS_DIR, filePath)) {
    sendApiError(request, response, 404, "ASSET_NOT_FOUND", "Card image not found.", { file });
    return;
  }
  if (!fsSync.existsSync(filePath)) {
    sendApiError(request, response, 404, "ASSET_NOT_FOUND", "Card image not found.", { file });
    return;
  }
  sendBinary(request, response, 200, await fs.readFile(filePath), "image/png");
}

async function handleV1GetCardAudio(request, response, cardId) {
  const { card } = await findCardById(cardId);
  if (!card) {
    sendApiError(request, response, 404, "CARD_NOT_FOUND", "Card not found.", { id: cardId });
    return;
  }
  const filePath = await findCachedAudioForCard(card);
  if (!filePath) {
    sendApiError(request, response, 404, "AUDIO_NOT_FOUND", "Cached audio not found for card.", { id: cardId });
    return;
  }
  sendBinary(request, response, 200, await fs.readFile(filePath), "audio/mpeg");
}

async function handleV1PostCardAudio(request, response, cardId) {
  const { card } = await findCardById(cardId);
  if (!card) {
    sendApiError(request, response, 404, "CARD_NOT_FOUND", "Card not found.", { id: cardId });
    return;
  }
  const bodyText = await readBody(request);
  const body = bodyText ? JSON.parse(bodyText) : {};
  const text = String(body.text || card.word).trim();
  const settings = body.settings || serverTtsSettings();
  if (!settings.apiKey || !(settings.ttsEndpoint || settings.baseURL)) {
    sendApiError(request, response, 400, "TTS_NOT_CONFIGURED", "Server TTS settings are not configured.");
    return;
  }
  const voiceModel = body.voiceModel || settings.ttsModel || "edge-tts/en-US-SteffanNeural";
  const { filePath, relativePath } = audioCachePath({ text, voiceModel });
  if (!(await fileExists(filePath))) {
    const audio = await generateTtsAudio({ text, settings: { ...settings, ttsModel: voiceModel } });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, audio);
  }
  sendJson(request, response, 200, { audioUrl: `/v1/audio/${encodeURIComponent(card.id)}`, legacyAudioUrl: relativePath, cached: true });
}

async function streamLlmText({ request, response, messages, settings: requestSettings }) {
  const settings = requestSettings || serverLlmSettings();
  if (!settings.apiKey || !settings.baseURL || !settings.model) {
    sendApiError(request, response, 400, "LLM_NOT_CONFIGURED", "Server LLM settings are not configured.");
    return;
  }
  const outboundSettings = normalizeOutboundSettings(settings);
  const endpoint = `${String(outboundSettings.baseURL).replace(/\/+$/, "")}/chat/completions`;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${outboundSettings.apiKey}`,
    },
    body: JSON.stringify({
      model: outboundSettings.model,
      stream: true,
      messages,
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text().catch(() => "");
    sendApiError(request, response, upstream.status || 502, "LLM_REQUEST_FAILED", "LLM request failed.", {
      status: upstream.status,
      message: message.slice(0, 300),
    });
    return;
  }

  streamHeaders(request, response);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalText = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.replace(/^data:\s*/, "");
      if (data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        const content = event.choices?.[0]?.delta?.content
          || event.output_text
          || (Array.isArray(event.output) ? event.output.flatMap(item => item.content || []).map(content => content.text || "").join("") : "")
          || "";
        if (content) {
          finalText += content;
          writeEvent(response, { type: "delta", content });
        }
      } catch {
        // Ignore malformed provider chunks; the final event still closes the stream.
      }
    }
  }
  writeEvent(response, { type: "done", content: finalText });
  response.end();
}

async function handleV1ChatCompletions(request, response) {
  const body = JSON.parse(await readBody(request));
  const settings = body.settings || serverLlmSettings();
  if (!settings.apiKey || !settings.baseURL || !settings.model) {
    sendApiError(request, response, 400, "LLM_NOT_CONFIGURED", "Server LLM settings are not configured.");
    return;
  }
  const outboundSettings = normalizeOutboundSettings(settings);
  const endpoint = `${String(outboundSettings.baseURL).replace(/\/+$/, "")}/chat/completions`;
  
  const stream = body.stream ?? false;
  const requestBody = {
    model: outboundSettings.model,
    messages: body.messages,
    stream,
    temperature: body.temperature,
    response_format: body.response_format,
  };
  
  if (stream) {
    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${outboundSettings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendApiError(request, response, 502, "LLM_REQUEST_FAILED", `LLM request failed: ${message}`);
      return;
    }
    
    if (!upstream.ok || !upstream.body) {
      const message = await upstream.text().catch(() => "");
      sendApiError(request, response, upstream.status || 502, "LLM_REQUEST_FAILED", "LLM request failed.", {
        status: upstream.status,
        message: message.slice(0, 300),
      });
      return;
    }
    
    const requestOrigin = request.headers.origin;
    const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "http://localhost:22052";
    response.writeHead(200, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        response.write(`${line}\n`);
      }
    }
    response.write(`${buffer}\n`);
    response.end();
  } else {
    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${outboundSettings.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendApiError(request, response, 502, "LLM_REQUEST_FAILED", `LLM request failed: ${message}`);
      return;
    }
    
    const text = await upstream.text();
    const requestOrigin = request.headers.origin;
    const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "http://localhost:22052";
    response.writeHead(upstream.status, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(text);
  }
}

async function handleV1RecordUsedWords(request, response) {
  try {
    const body = JSON.parse(await readBody(request));
    const words = Array.isArray(body.words) ? body.words : [];
    
    const filePath = path.join(ROOT, "listening_vocabulary_history.json");
    let cache = { updatedAt: new Date().toISOString(), words: {} };
    
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.words) {
        cache = parsed;
      }
    } catch (readError) {
      // File doesn't exist or is invalid, use default empty cache
    }
    
    const now = new Date();
    const nowTime = now.getTime();
    
    // Add new words
    for (const w of words) {
      const cleanWord = String(w).trim().toLowerCase();
      if (!cleanWord) continue;
      
      if (cache.words[cleanWord]) {
        cache.words[cleanWord].count = (cache.words[cleanWord].count || 0) + 1;
        cache.words[cleanWord].lastUsed = now.toISOString();
      } else {
        cache.words[cleanWord] = {
          count: 1,
          lastUsed: now.toISOString()
        };
      }
    }
    
    // Filter out words older than 12 hours
    const filteredWords = {};
    const limitMs = 12 * 60 * 60 * 1000;
    
    for (const [cleanWord, info] of Object.entries(cache.words)) {
      const lastUsedTime = new Date(info.lastUsed).getTime();
      if (nowTime - lastUsedTime <= limitMs) {
        filteredWords[cleanWord] = info;
      }
    }
    
    cache.words = filteredWords;
    cache.updatedAt = now.toISOString();
    
    await fs.writeFile(filePath, JSON.stringify(cache, null, 2), "utf8");
    
    const requestOrigin = request.headers.origin;
    const origin = ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "http://localhost:22052";
    response.writeHead(200, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ success: true, count: Object.keys(cache.words).length }));
  } catch (error) {
    sendApiError(request, response, 500, "INTERNAL_ERROR", `Failed to record used words: ${error.message}`);
  }
}

async function handleV1CardAgent(request, response, cardId) {
  const { card } = await findCardById(cardId);
  if (!card) {
    sendApiError(request, response, 404, "CARD_NOT_FOUND", "Card not found.", { id: cardId });
    return;
  }
  const body = JSON.parse(await readBody(request));
  const message = String(body.message || "").trim() || "Explain this word for a TOEIC learner.";
  await streamLlmText({
    request,
    response,
    settings: body.settings,
    messages: [
      {
        role: "system",
        content: [
          "You are the Agent Assistant for one vocabulary card.",
          "Answer concisely with practical TOEIC examples and Vietnamese support when useful.",
          `Card: ${card.word}`,
          `Pronunciation: ${card.pronunciation || ""}`,
          `Part of speech: ${card.partOfSpeech}`,
          `Topic: ${card.topic}`,
          `Tags: ${card.tags.join(", ")}`,
        ].join("\n"),
      },
      { role: "user", content: message },
    ],
  });
}

async function handleV1GlobalStream(request, response, mode) {
  const body = JSON.parse(await readBody(request));
  const manifest = await readNormalizedManifest();
  const scope = normalizeContextScope(body.contextScope);
  const scopedCards = applyContextScope(manifest.cards, scope);
  const context = scopedCards
    .slice(0, 80)
    .map((card) => `${card.word} (${card.partOfSpeech}; ${card.topic}; level=${card.level})`)
    .join("\n");
  const message = String(body.message || "").trim() || `Generate ${mode} practice from the current vocabulary set.`;
  await streamLlmText({
    request,
    response,
    settings: body.settings,
    messages: [
      {
        role: "system",
        content: [
          "You are the Global Agent for a TOEIC vocabulary app.",
          "Use the provided vocabulary context. Keep output useful on mobile.",
          `Mode: ${mode}`,
          `Context scope: ${scope.type}`,
          "Vocabulary context:",
          context || "(empty)",
        ].join("\n"),
      },
      { role: "user", content: message },
    ],
  });
}

function normalizeContextScope(value) {
  const raw = value && typeof value === "object" ? value : {};
  const type = ["all", "today", "topic", "level", "createdDate", "custom"].includes(raw.type) ? raw.type : "all";
  return {
    type,
    topic: String(raw.topic || "").trim(),
    level: String(raw.level || "").trim(),
    date: String(raw.date || "").trim(),
    cardIds: Array.isArray(raw.cardIds) ? raw.cardIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 100) : [],
  };
}

function applyContextScope(cards, scope) {
  if (scope.type === "today") {
    const today = new Date().toISOString().slice(0, 10);
    return cards.filter((card) => String(card.createdAt || card.updatedAt || "").startsWith(today));
  }
  if (scope.type === "topic" && scope.topic) {
    return cards.filter((card) => String(card.topic || "").toLowerCase() === scope.topic.toLowerCase());
  }
  if (scope.type === "level" && scope.level) {
    return cards.filter((card) => String(card.level || "").toLowerCase() === scope.level.toLowerCase());
  }
  if (scope.type === "createdDate" && scope.date) {
    return cards.filter((card) => String(card.createdAt || card.updatedAt || "").startsWith(scope.date));
  }
  if (scope.type === "custom" && scope.cardIds.length) {
    const ids = new Set(scope.cardIds.map((id) => id.toLowerCase()));
    return cards.filter((card) => ids.has(String(card.id || "").toLowerCase()) || ids.has(String(card.slug || "").toLowerCase()) || ids.has(String(card.word || "").toLowerCase()));
  }
  return cards;
}

async function handleV1PracticeAttempts(request, response) {
  const body = JSON.parse(await readBody(request));
  const attempts = Array.isArray(body.attempts) ? body.attempts : [];
  if (!attempts.length) {
    sendApiError(request, response, 400, "INVALID_ATTEMPTS", "Request must include at least one practice attempt.");
    return;
  }
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const now = new Date().toISOString();
  const lines = attempts
    .slice(0, 100)
    .map((attempt) =>
      JSON.stringify({
        id: String(attempt.id || crypto.randomUUID()),
        type: String(attempt.type || "practice").slice(0, 48),
        prompt: String(attempt.prompt || "").slice(0, 4000),
        response: String(attempt.response || "").slice(0, 20000),
        selectedAnswer: attempt.selectedAnswer == null ? null : String(attempt.selectedAnswer).slice(0, 500),
        correctAnswer: attempt.correctAnswer == null ? null : String(attempt.correctAnswer).slice(0, 500),
        contextScope: normalizeContextScope(attempt.contextScope),
        createdAt: String(attempt.createdAt || now),
        syncedAt: now,
      }),
    )
    .join("\n");
  await fs.appendFile(PRACTICE_ATTEMPTS_PATH, `${lines}\n`, "utf8");
  sendJson(request, response, 200, { status: "ok", synced: attempts.length });
}

async function handleV1Request(request, response, url) {
  if (!requireVocaApiToken(request, response)) return;

  const pathname = decodeURIComponent(url.pathname);
  console.log(`${new Date().toISOString()} ${request.method} ${pathname}`);
  if (request.method === "GET" && pathname === "/v1/health") {
    await handleV1Health(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/v1/settings") {
    const config = await readServerConfig();
    sendJson(request, response, 200, { searchMode: config.searchMode || null });
    return;
  }
  if (request.method === "POST" && pathname === "/v1/settings") {
    try {
      const body = JSON.parse(await readBody(request));
      const config = await readServerConfig();
      if (body.searchMode === "default" || body.searchMode === "idioms") {
        config.searchMode = body.searchMode;
        await writeServerConfig(config);
        sendJson(request, response, 200, { status: "ok", config });
      } else {
        sendApiError(request, response, 400, "INVALID_MODE", "Invalid searchMode. Must be 'default' or 'idioms'.");
      }
    } catch (error) {
      sendApiError(request, response, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (request.method === "GET" && pathname === "/v1/sync/bootstrap") {
    await handleV1Bootstrap(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/v1/cards") {
    await handleV1Cards(request, response, url);
    return;
  }
  if (request.method === "DELETE" && pathname === "/v1/cards") {
    await handleV1ClearAllCards(request, response);
    return;
  }
  const cardMatch = pathname.match(/^\/v1\/cards\/([^/]+)$/);
  if (cardMatch && request.method === "GET") {
    await handleV1CardById(request, response, cardMatch[1]);
    return;
  }
  if (cardMatch && request.method === "DELETE") {
    await handleV1DeleteCard(request, response, cardMatch[1]);
    return;
  }
  const levelMatch = pathname.match(/^\/v1\/cards\/([^/]+)\/level$/);
  if (levelMatch && request.method === "PATCH") {
    await handleV1PatchCardLevel(request, response, levelMatch[1]);
    return;
  }
  const cardAgentMatch = pathname.match(/^\/v1\/agent\/card\/([^/]+)\/chat$/);
  if (cardAgentMatch && request.method === "POST") {
    await handleV1CardAgent(request, response, cardAgentMatch[1]);
    return;
  }
  if (pathname === "/v1/agent/global/chat" && request.method === "POST") {
    await handleV1GlobalStream(request, response, "assistant");
    return;
  }
  const practiceMatch = pathname.match(/^\/v1\/practice\/(drills|reading|article|conversation)$/);
  if (practiceMatch && request.method === "POST") {
    await handleV1GlobalStream(request, response, practiceMatch[1]);
    return;
  }
  if (pathname === "/v1/practice/attempts" && request.method === "POST") {
    await handleV1PracticeAttempts(request, response);
    return;
  }
  const assetMatch = pathname.match(/^\/v1\/assets\/cards\/([^/]+)$/);
  if (assetMatch && (request.method === "GET" || request.method === "HEAD")) {
    await handleV1CardAsset(request, response, assetMatch[1]);
    return;
  }
  const audioMatch = pathname.match(/^\/v1\/audio\/([^/]+)$/);
  if (audioMatch && request.method === "GET") {
    await handleV1GetCardAudio(request, response, audioMatch[1]);
    return;
  }
  if (audioMatch && request.method === "POST") {
    await handleV1PostCardAudio(request, response, audioMatch[1]);
    return;
  }
  if (pathname === "/v1/cards/create" && request.method === "POST") {
    try {
      const body = JSON.parse(await readBody(request));
      await handleCreateCardRequest(request, response, body);
    } catch (error) {
      if (response.headersSent) {
        writeEvent(response, { type: "error", message: error instanceof Error ? error.message : String(error) });
        response.end();
      } else {
        sendJson(request, response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return;
  }
  if (pathname === "/v1/chat/completions" && request.method === "POST") {
    await handleV1ChatCompletions(request, response);
    return;
  }
  if (pathname === "/v1/listen/record-used-words" && request.method === "POST") {
    await handleV1RecordUsedWords(request, response);
    return;
  }
  sendApiError(request, response, 404, "NOT_FOUND", "Not found.");
}

function runCreateCard({ word, keyword, settings, response, silentDone = false }) {
  return new Promise((resolve, reject) => {
    const outboundSettings = normalizeOutboundSettings(settings);
    const child = spawn(process.execPath, [CREATE_CARD_SCRIPT, word], {
      cwd: ROOT,
      env: {
        ...process.env,
        OPENAI_API_KEY: outboundSettings.apiKey,
        OPENAI_BASE_URL: outboundSettings.baseURL,
        OPENAI_MODEL: outboundSettings.model,
        VOCA_KEYWORD: keyword || word,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdoutBuffer = "";
    const events = [];
    const emitLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        event = { type: "log", message: trimmed };
      }

      if (event.type === "progress" && event.message && !event.message.startsWith(`[${word}]`)) {
        event.message = `[${word}] ${event.message}`;
      }
      if (event.type === "log" && event.message && !event.message.startsWith(`[${word}]`)) {
        event.message = `[${word}] ${event.message}`;
      }

      events.push(event);

      if (event.type === "done" && silentDone) {
        return;
      }
      writeEvent(response, event);
    };
    child.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        emitLine(line);
      }
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      emitLine(stdoutBuffer);
      if (code === 0) {
        resolve({ events, stderr });
        return;
      }
      reject(new Error(stderr || `voca-create-card failed with code ${code}`));
    });
  });
}

async function handleCreateCardRequest(request, response, body) {
  const word = normalizeWord(body.word);
  if (!word) {
    sendApiError(request, response, 400, "MISSING_WORD", "Missing word.");
    return;
  }
  const settings = body.settings || {};
  const activeApiKey = settings.apiKey || process.env.VOCA_LLM_API_KEY || process.env.OPENAI_API_KEY;
  const activeBaseURL = settings.baseURL || process.env.VOCA_LLM_BASE_URL || process.env.OPENAI_BASE_URL;
  const activeModel = settings.model || process.env.VOCA_LLM_MODEL || process.env.OPENAI_MODEL;

  if (!activeApiKey || !activeBaseURL || !activeModel) {
    sendApiError(request, response, 400, "LLM_NOT_CONFIGURED", "Server LLM settings are not configured.");
    return;
  }

  const resolvedSettings = {
    apiKey: activeApiKey,
    baseURL: activeBaseURL,
    model: activeModel,
  };

  const config = await readServerConfig();
  const searchMode = config.searchMode || "default";

  if (searchMode === "idioms") {
    streamHeaders(request, response);
    writeEvent(response, { type: "progress", message: `AI is finding common idioms/collocations for "${word}"...` });
    try {
      const outboundSettings = normalizeOutboundSettings(resolvedSettings);
      const endpoint = `${String(outboundSettings.baseURL).replace(/\/+$/, "")}/chat/completions`;
      
      const prompt = `Give me up to 3 of the most common idioms, phrasal verbs, or collocations that contain the word "${word}".
Rules:
- Only return high-frequency, highly practical phrases that are actually useful for TOEIC and daily English.
- Ensure the phrases are distinct and cover different usage patterns. Do NOT return multiple phrases built on the exact same phrasal verb base (e.g. do not return "keep up with", "keep up appearances", and "keep up the good work" together. Instead, choose only one "keep up" variation, and find other patterns like "keep track of" or "keep in mind" for the remaining slots).
- If there are fewer than 3 extremely common phrases, return only those (1 or 2).
- If there are no common, useful, or natural idioms/phrasal verbs/collocations containing the word, return an empty array [].
- Do NOT generate rare or unnatural phrases just to fill the list.

Return ONLY a JSON object in this exact schema:
{
  "phrases": ["phrase 1", "phrase 2", "phrase 3"]
}`;

      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${outboundSettings.apiKey}`,
        },
        body: JSON.stringify({
          model: outboundSettings.model,
          stream: false,
          messages: [
            {
              role: "system",
              content: "You are a helpful TOEIC English dictionary assistant. You must return only a valid JSON object matching the requested schema.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        }),
      });

      if (!upstream.ok) {
        throw new Error(`LLM API returned error (${upstream.status})`);
      }

      const data = await upstream.json();
      const choice = data.choices?.[0];
      const aiContent = choice?.message?.content || "";
      const parsed = extractJson(aiContent);
      const phrases = Array.isArray(parsed.phrases)
        ? parsed.phrases.map((p) => String(p).trim()).filter(Boolean)
        : [];

      if (phrases.length === 0) {
        writeEvent(response, { type: "progress", message: `No common idioms found for "${word}". Falling back to creating card for "${word}" itself...` });
        try {
          const result = await createCardLimiter.run(() =>
            runCreateCard({ word, settings: resolvedSettings, response })
          );
          const done = [...result.events].reverse().find((event) => event.type === "done");
          if (!done) {
            writeEvent(response, { type: "done", message: "Completed", copied: [], skipped: [], outputDir: undefined });
          }
          response.end();
        } catch (err) {
          writeEvent(response, { type: "error", message: err.message });
          response.end();
        }
        return;
      }

      let createdCount = 0;
      const skipped = [];
      const copied = [];

      const tasks = phrases.map((phrase) => {
        return createCardLimiter.run(async () => {
          try {
            const result = await runCreateCard({
              word: phrase,
              keyword: word,
              settings: resolvedSettings,
              response,
              silentDone: true,
            });
            const doneEvent = [...result.events].reverse().find((event) => event.type === "done");
            if (doneEvent) {
              if (doneEvent.copied) copied.push(...doneEvent.copied);
              if (doneEvent.skipped) skipped.push(...doneEvent.skipped);
            }
            createdCount++;
          } catch (err) {
            writeEvent(response, {
              type: "log",
              message: `Error creating card for "${phrase}": ${err.message}`
            });
          }
        });
      });

      await Promise.all(tasks);

      writeEvent(response, {
        type: "done",
        message: `Successfully created ${createdCount} idiom card(s)!`,
        copied,
        skipped
      });
      response.end();
    } catch (err) {
      writeEvent(response, { type: "error", message: err.message });
      response.end();
    }
  } else {
    streamHeaders(request, response);
    try {
      const result = await createCardLimiter.run(() =>
        runCreateCard({ word, settings: resolvedSettings, response })
      );
      const done = [...result.events].reverse().find((event) => event.type === "done");
      if (!done) {
        writeEvent(response, { type: "done", message: "Completed", copied: [], skipped: [], outputDir: undefined });
      }
      response.end();
    } catch (err) {
      writeEvent(response, { type: "error", message: err.message });
      response.end();
    }
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (url.pathname.startsWith("/v1/")) {
    try {
      await handleV1Request(request, response, url);
    } catch (error) {
      sendApiError(request, response, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (request.method === "GET" && request.url?.startsWith("/audio/")) {
    await handleAudioFile(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/tts-cache") {
    try {
      await handleTtsCache(request, response);
    } catch (error) {
      sendJson(request, response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/fill-meanings") {
    try {
      const body = JSON.parse(await readBody(request));
      const updates = body.updates;
      if (!Array.isArray(updates)) {
        throw new Error("Missing updates array.");
      }
      
      const manifest = await readManifestFile();
      let updatedCount = 0;
      const updatedCards = manifest.cards.map((card) => {
        const found = updates.find((u) => u && String(u.word).toLowerCase().trim() === String(card.word).toLowerCase().trim());
        if (found && found.meaningVi && found.meaningEn) {
          updatedCount++;
          return {
            ...card,
            meaningEn: String(found.meaningEn).trim(),
            meaningVi: String(found.meaningVi).trim(),
          };
        }
        return card;
      });

      if (updatedCount > 0) {
        await writeManifestCards(updatedCards);
      }

      sendJson(request, response, 200, { success: true, updatedCount });
    } catch (error) {
      sendJson(request, response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method !== "POST" || request.url !== "/create-card") {
    sendJson(request, response, 404, { error: "Not found" });
    return;
  }

  try {
    const body = JSON.parse(await readBody(request));
    await handleCreateCardRequest(request, response, body);
  } catch (error) {
    if (response.headersSent) {
      writeEvent(response, { type: "error", message: error instanceof Error ? error.message : String(error) });
      response.end();
    } else {
      sendJson(request, response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`Voca local API listening on http://${BIND_HOST}:${PORT}`);
});
