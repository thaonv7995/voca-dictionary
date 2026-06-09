import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  ExternalLink,
  GripVertical,
  Keyboard,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { imagePath } from "./data/manifest";
import {
  canonicalTopic,
  createdDateOnly,
  createdDateFilterLabel,
  filterCards,
  uniqueSortedValues,
  type CreatedDateFilter,
  type Filters,
} from "@voca/core/data/search";
import { extractLlmDeltaText, extractLlmResponseText } from "@voca/core/data/llm";
import { type Card, slugify } from "@voca/core/data/schema";
import { visibleTags } from "@voca/core/data/tags";
import { useManifest } from "./hooks/useManifest";
import { readJson, useStoredState, writeJson } from "./lib/storage";
import { bridgeAuthorizationHeader, defaultVocaApiToken, patchBridgeCardLevel, resolvedLocalBridgeOrigin } from "./local-bridge";
import {
  maybeParseQuickQuiz,
  parseArticlePractice,
  parseDrillText,
  parseReadingContext,
} from "@voca/core/practice/parsers";
import { articlePracticePrompt, drillPrompt, readingPrompt } from "@voca/core/practice/prompts";
import { revisePracticePrompt } from "@voca/core/practice/judge";
import {
  assessArticlePracticeQuality,
  assessDrillBatchQuality,
  assessReadingQuality,
} from "@voca/core/practice/quality";
import { practiceWeaknessPrompt, recordPracticeAttempt } from "./practice/attempts";
import type {
  ArticlePractice,
  ChallengeDrill,
  QuickQuiz,
  QuickQuizQuestion,
  ReadingContext,
  ReadingDocumentType,
  ReadingFormat,
  ReadingQuestion,
  ReadingQueue,
} from "@voca/core/practice/types";
import { normalizeAnswer, shuffleItems } from "@voca/core/practice/utils";

const GLOBAL_AGENT_PANEL_STORAGE_KEY = "voca.globalAgent.panelWidthPx";
const DEFAULT_GLOBAL_AGENT_PANEL_PX = 720;
const GLOBAL_AGENT_PANEL_MIN_PX = 380;
const GLOBAL_AGENT_PANEL_MAX_PX = 1200;

type Theme = "light" | "dark";

type AiSettings = {
  baseURL: string;
  apiKey: string;
  model: string;
  ttsEndpoint: string;
  ttsModel: string;
  conversationVoiceA: string;
  conversationVoiceB: string;
  conversationVoiceC: string;
  conversationAutoSelectVoices: boolean;
  nonStopListeningEnabled: boolean;
  nonStopListeningPreloadCount: number;
  useApiTts: boolean;
  /** Empty = default (127.0.0.1:22053 or VITE_LOCAL_BRIDGE_ORIGIN). */
  localBridgeOrigin: string;
  /** Sent as Authorization: Bearer … for /v1/cards, PATCH level, create-card, and TTS cache. */
  bridgeApiToken: string;
  searchMode: "default" | "idioms";
};

type ActiveTask = {
  id: string;
  word: string;
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
  updatedAt: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

type AgentMode = "assistant" | "drills" | "reading" | "article" | "conversation";
type CardLevel = "new" | "learning" | "known" | "mastered";
type GlobalContextMode = "all" | "created" | "today" | "topic" | "level" | "custom";
type CreatedDateScope = "today" | "yesterday" | "last7" | "last30" | "older30";
type ConversationFormat = "auto" | "conversation" | "radio" | "announcement" | "story";

type ConversationLine = {
  id: string;
  speaker: string;
  text: string;
  translation?: string;
  vocabulary?: string[];
  vocabularyMeanings?: Record<string, string>;
};

type DailyConversation = {
  type: "daily_conversation";
  format?: Exclude<ConversationFormat, "auto">;
  title: string;
  context?: string;
  speakers: string[];
  voiceAssignments: Record<string, string>;
  lines: ConversationLine[];
};

type ConversationPlaybackUnit = {
  ids: string[];
  speaker: string;
  text: string;
};

type GlobalContextScope = {
  mode: GlobalContextMode;
  createdDate: CreatedDateScope;
  topic: string;
  level: CardLevel | "all";
  customKeys: string[];
};

function formatReadingDocumentKind(value: ReadingDocumentType): string {
  const labels: Record<ReadingDocumentType, string> = {
    email: "Email",
    notice: "Notice",
    memo: "Memo",
    article: "Article",
    message: "Message",
  };
  return labels[value];
}

/** Title is pointless if it's only repeating the genre (Email, Notice…) already implied by eyebrow/doc type */
function isRedundantReadingDocumentTitle(title: string | undefined, documentType: ReadingDocumentType): boolean {
  if (!title?.trim()) return false;
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/gi, "");
  const asTypeSlug = documentType.replace(/[^a-z]+/gi, "").toLowerCase();
  const asLabelSlug = formatReadingDocumentKind(documentType)
    .toLowerCase()
    .replace(/[^a-z]+/gi, "");
  return normalized === asTypeSlug || normalized === asLabelSlug;
}

type SuggestionCache = Record<string, { updatedAt: number; suggestions: string[] }>;
type ConversationCache = Record<string, { updatedAt: number; messages: ChatMessage[] }>;

type LayoutColumns = {
  list: number;
  preview: number;
  chat: number;
};

type CreateCardState = {
  word: string;
  status: "idle" | "creating" | "done" | "error";
  message: string;
};

type CreateCardEvent = {
  type?: string;
  message?: string;
  copied?: unknown[];
  skipped?: unknown[];
};

const defaultFilters: Filters = {
  query: "",
  topic: "all",
  partOfSpeech: "all",
  createdDate: "all",
};

const defaultTtsModel = "edge-tts/en-US-SteffanNeural";
const ttsVoiceOptions = [
  { value: "edge-tts/en-US-SteffanNeural", label: "Steffan (US) · M" },
  { value: "edge-tts/en-US-AvaNeural", label: "Ava (US) · F" },
  { value: "edge-tts/en-US-AndrewNeural", label: "Andrew (US) · M" },
  { value: "edge-tts/en-US-EmmaNeural", label: "Emma (US) · F" },
  { value: "edge-tts/en-US-BrianNeural", label: "Brian (US) · M" },
  { value: "edge-tts/en-GB-RyanNeural", label: "Ryan (UK) · M" },
  { value: "edge-tts/en-GB-SoniaNeural", label: "Sonia (UK) · F" },
  { value: "edge-tts/en-GB-LibbyNeural", label: "Libby (UK) · F" },
  { value: "edge-tts/en-AU-WilliamNeural", label: "William (AU) · M" },
  { value: "edge-tts/en-AU-NatashaNeural", label: "Natasha (AU) · F" },
  { value: "edge-tts/en-CA-LiamNeural", label: "Liam (CA) · M" },
  { value: "edge-tts/en-CA-ClaraNeural", label: "Clara (CA) · F" },
  { value: "edge-tts/en-SG-WayneNeural", label: "Wayne (SG) · M" },
  { value: "edge-tts/en-SG-LunaNeural", label: "Luna (SG) · F" },
];

const conversationFormatLabels: Record<ConversationFormat, string> = {
  auto: "All",
  conversation: "Conversation",
  radio: "Radio",
  announcement: "Announce",
  story: "Story",
};

const conversationPanelTitles: Record<Exclude<ConversationFormat, "auto">, string> = {
  conversation: "Daily Conversation",
  radio: "Daily Radio",
  announcement: "Daily Announcement",
  story: "Daily Story",
};

const defaultSettings: AiSettings = {
  baseURL: "",
  apiKey: "",
  model: "",
  ttsEndpoint: "",
  ttsModel: defaultTtsModel,
  conversationVoiceA: defaultTtsModel,
  conversationVoiceB: "edge-tts/en-US-AvaNeural",
  conversationVoiceC: "edge-tts/en-US-AndrewNeural",
  conversationAutoSelectVoices: true,
  nonStopListeningEnabled: false,
  nonStopListeningPreloadCount: 2,
  useApiTts: true,
  localBridgeOrigin: "",
  bridgeApiToken: defaultVocaApiToken(),
  searchMode: "default",
};

const defaultGlobalContextScope: GlobalContextScope = {
  mode: "all",
  createdDate: "today",
  topic: "all",
  level: "all",
  customKeys: [],
};



async function fetchLlm(settings: AiSettings, body: any): Promise<Response> {
  const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
  let isBridgeReachable = false;
  try {
    const response = await fetch(`${bridgeOrigin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...bridgeAuthorizationHeader(settings.bridgeApiToken),
      },
      body: JSON.stringify({
        ...body,
        settings,
      }),
    });
    isBridgeReachable = true;
    if (response.ok) return response;
    if (response.status === 404) {
      throw new Error(`Endpoint '/v1/chat/completions' not found on bridge proxy (status 404). Please ensure your bridge API server (at ${bridgeOrigin}) is updated to the latest version and restarted.`);
    }
    return response;
  } catch (err) {
    if (isBridgeReachable) {
      throw err;
    }
    console.warn("Local bridge LLM proxy unavailable, falling back to direct call:", err);
  }

  return fetch(`${settings.baseURL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

const suggestionTtlMs = 60 * 60 * 1000;
const conversationTtlMs = 60 * 60 * 1000;
const nonStopIntroGapMs = 850;
const nonStopItemGapMs = 4200;
const drillBatchSize = 5;
const drillPrefetchThreshold = 2;
const drillChoiceLabels = ["A", "B", "C", "D"];
const readingCacheTarget = 2;
const cardLevelLabels: Record<CardLevel, string> = {
  new: "New",
  learning: "Learning",
  known: "Known",
  mastered: "Mastered",
};

const cardLevelRank: Record<CardLevel, number> = {
  new: 0,
  learning: 1,
  known: 2,
  mastered: 3,
};

const cardLevelOrder: CardLevel[] = ["new", "learning", "known", "mastered"];

function createdAtRank(card: Pick<Card, "createdAt">): number {
  if (!card.createdAt) return 0;
  const timestamp = Date.parse(card.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function todayIsoDate(): string {
  return isoDateDaysAgo(0);
}

function isoDateDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function createdDateLabel(scope: CreatedDateScope): string {
  switch (scope) {
    case "today":
      return `Created today (${todayIsoDate()})`;
    case "yesterday":
      return `Created yesterday (${isoDateDaysAgo(1)})`;
    case "last7":
      return `Created in the last 7 days (${isoDateDaysAgo(6)} - ${todayIsoDate()})`;
    case "last30":
      return `Created in the last 30 days (${isoDateDaysAgo(29)} - ${todayIsoDate()})`;
    case "older30":
      return `Created before ${isoDateDaysAgo(29)}`;
  }
}

function isCardInCreatedDateScope(card: Pick<Card, "createdAt">, scope: CreatedDateScope): boolean {
  const createdDate = createdDateOnly(card.createdAt);
  if (!createdDate) return false;
  const today = todayIsoDate();
  const yesterday = isoDateDaysAgo(1);
  const last7Start = isoDateDaysAgo(6);
  const last30Start = isoDateDaysAgo(29);
  switch (scope) {
    case "today":
      return createdDate === today;
    case "yesterday":
      return createdDate === yesterday;
    case "last7":
      return createdDate >= last7Start && createdDate <= today;
    case "last30":
      return createdDate >= last30Start && createdDate <= today;
    case "older30":
      return createdDate < last30Start;
  }
}

function sortCardsByLearningPriority(cards: Card[]): Card[] {
  return [...cards].sort(
    (first, second) =>
      cardLevelRank[first.level] - cardLevelRank[second.level]
      || createdAtRank(second) - createdAtRank(first)
      || first.word.localeCompare(second.word),
  );
}

function sortCardsByCreatedNewest(cards: Card[]): Card[] {
  return [...cards].sort(
    (first, second) =>
      createdAtRank(second) - createdAtRank(first)
      || first.word.localeCompare(second.word),
  );
}

const defaultLayout: LayoutColumns = {
  list: 520,
  preview: 560,
  chat: 420,
};

function formatTime(value: number | null): string {
  if (!value) return "Not loaded yet";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function systemPrompt(card: Card, recentQuizAnswers: string[] = []): string {
  return [
    "You are an Agent Assistant for a vocabulary dictionary app.",
    "You are also a patient English tutor and TOEIC coach.",
    "Keep answers short and scan-friendly.",
    "Default response length: 4-8 lines total, around 120 words unless the user explicitly asks for a table, long list, comparison, practice set, or detailed explanation.",
    "For normal questions, use at most 3 short sections, 3 bullets, and 2 examples.",
    "For detailed questions, be as long as needed but stay structured and avoid filler.",
    "No long intros, no recap, no closing summary.",
    "Answer in simple English with Vietnamese support when useful.",
    "If the word seems misspelled, mention the likely correction in one short line, then continue briefly. Do not turn the whole answer into a spelling correction.",
    "Use concise markdown with short headings and bullet lists when helpful.",
    "When creating a quick quiz, missing-word quiz, fill-in quiz, or short answer quiz, return JSON only using this shape: {\"type\":\"quick_quiz\",\"title\":\"...\",\"instructions\":\"...\",\"questions\":[{\"prompt\":\"...\",\"answer\":\"...\",\"accepted\":[\"...\"],\"choices\":[\"...\"]}]}",
    "For quick_quiz, focus on the current word, close confusions, collocations, TOEIC traps, and short applied usage. Include related words only when they help the current word.",
    "For quick_quiz, keep it lightweight: create 1-3 questions only, prefer 1-2 questions by default. Follow a user-requested count exactly only if they explicitly ask for a specific number.",
    "For quick_quiz, avoid repeating recent prompts, examples, answer choices, and the same question pattern unless the user asks to review mistakes.",
    "For quick_quiz choices, choices are optional. If included, include the answer and vary the answer position.",
    recentQuizAnswers.length ? `Recent quiz answers to avoid repeating: ${recentQuizAnswers.join(", ")}` : "No recent quiz answers yet.",
    `Current word or phrase: ${card.word}`,
    `Part of speech: ${card.partOfSpeech}`,
    `Topic: ${card.topic}`,
    `Tags: ${card.tags.join(", ")}`,
  ].join("\n");
}

function globalAgentPrompt(
  targetVocabularyIndex: string[],
  selectedWord?: string,
  recentQuizAnswers: string[] = [],
  contextDescription = "All words",
  weaknessContext = "No recorded practice mistakes yet.",
): string {
  return [
    "You are the global Voca Agent for a vocabulary learning app.",
    "You have access to targetVocabularyIndex, the active learning context selected by the user. It may be the full deck or a smaller group.",
    `Active context: ${contextDescription}.`,
    "The targetVocabularyIndex is ordered by learning priority: new and learning words first, mastered words last.",
    "When generating quizzes or practice, prefer earlier unmastered words unless the user asks for a specific word or review set.",
    weaknessContext,
    "Use recent mistakes to bias quiz targets and traps, but do not repeat exact previous prompts.",
    "Use targetVocabularyIndex as the source of truth for target answers and reading/drill focus words.",
    "For wrong choices, related words, comparisons, and supporting examples, you may create plausible words or phrases yourself. Do not restrict all A/B/C/D choices to only the selected target words.",
    "Keep normal answers short and scan-friendly unless the user asks for detail, a table, a long list, or a practice set.",
    "Do not create micro-scenario drills unless the user asks for drills or the app is in drills mode.",
    "When creating a quick quiz, missing-word quiz, fill-in quiz, or short answer quiz, return JSON only using this shape: {\"type\":\"quick_quiz\",\"title\":\"...\",\"instructions\":\"...\",\"questions\":[{\"prompt\":\"...\",\"answer\":\"...\",\"accepted\":[\"...\"],\"choices\":[\"...\"]}]}",
    "For quick_quiz, keep it lightweight: create 1-3 questions only, prefer 1-2 questions by default. Follow a user-requested count exactly only if they explicitly ask for a specific number.",
    "For generic quick quiz requests, avoid repeating the same question count or pattern mechanically from recent quiz messages, but stay within 1-3 questions.",
    "For quick_quiz, choose correct answers primarily from targetVocabularyIndex. Avoid repeating target words, answer choices, or the same topic from recent quiz messages unless the user asks to review mistakes.",
    "For quick_quiz, first choose target answers from words that are not in the recent quiz answers list. Use recent quiz answers only if the user explicitly asks to review them.",
    "For quick_quiz, choices are optional. If included, include the answer and create plausible distractors when useful.",
    "For quick_quiz choices, vary the answer position. Do not put every correct answer first.",
    "Answer in simple English with Vietnamese support when useful.",
    selectedWord ? `Currently selected word: ${selectedWord}` : "No selected word.",
    recentQuizAnswers.length ? `Recent quiz answers to avoid repeating: ${recentQuizAnswers.join(", ")}` : "No recent quiz answers yet.",
    `Target vocabulary index JSON: ${JSON.stringify(targetVocabularyIndex)}`,
  ].join("\n");
}

function cardKey(card: Card): string {
  return card.slug || card.file;
}

function cardPronunciation(card: Card): string {
  return card.pronunciation || card.ipa || "";
}

let activeSpeechAudio: HTMLAudioElement | null = null;
let activeSpeechStop: (() => void) | null = null;
const speechAudioUrlCache = new Map<string, string>();

function speechCacheKey(text: string, model: string): string {
  return `${model}::${text.trim()}`;
}

function stopCurrentSpeech() {
  const resolveActiveSpeech = activeSpeechStop;
  activeSpeechStop = null;
  if (activeSpeechAudio) {
    activeSpeechAudio.pause();
    activeSpeechAudio.currentTime = 0;
    activeSpeechAudio = null;
  }
  resolveActiveSpeech?.();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function waitForAudioEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (activeSpeechAudio === audio) activeSpeechAudio = null;
      if (activeSpeechStop === resolveStopped) activeSpeechStop = null;
    };
    const resolveStopped = () => {
      cleanup();
      resolve();
    };
    activeSpeechStop = resolveStopped;
    audio.addEventListener(
      "ended",
      () => {
        cleanup();
        resolve();
      },
      { once: true },
    );
    audio.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("Audio playback failed."));
      },
      { once: true },
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function speakWithBrowserVoice(text: string, options?: { waitForEnd?: boolean }) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  const cleanText = text.trim();
  if (!cleanText) return Promise.resolve();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = "en-US";
  utterance.rate = 0.88;
  utterance.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("en-us")) || voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (preferredVoice) utterance.voice = preferredVoice;
  const ended = options?.waitForEnd
    ? new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          if (activeSpeechStop === resolveStopped) activeSpeechStop = null;
        };
        const resolveStopped = () => {
          cleanup();
          resolve();
        };
        activeSpeechStop = resolveStopped;
        utterance.onend = () => {
          cleanup();
          resolve();
        };
        utterance.onerror = () => {
          cleanup();
          reject(new Error("Browser speech failed."));
        };
      })
    : Promise.resolve();
  window.speechSynthesis.speak(utterance);
  return ended;
}

async function speakEnglish(text: string, settings?: AiSettings, options?: { ttsModel?: string; waitForEnd?: boolean }) {
  const cleanText = text.trim();
  if (!cleanText) return;
  stopCurrentSpeech();
  const bridgeOrigin = resolvedLocalBridgeOrigin(settings?.localBridgeOrigin);
  const apiSettings = settings?.useApiTts !== false && settings?.apiKey && (settings.ttsEndpoint || settings.baseURL) ? settings : null;
  const model = options?.ttsModel || apiSettings?.ttsModel || defaultTtsModel;
  const requestSettings = apiSettings ? { ...apiSettings, ttsModel: model } : null;
  const cachedAudioUrl = speechAudioUrlCache.get(speechCacheKey(cleanText, model));

  if (cachedAudioUrl) {
    try {
      const audio = new Audio(cachedAudioUrl);
      activeSpeechAudio = audio;
      const ended = options?.waitForEnd ? waitForAudioEnd(audio) : Promise.resolve();
      await audio.play();
      await ended;
      return;
    } catch {
      // Fall through to cache/API/browser paths.
    }
  }

  if (requestSettings) {
    try {
      const cacheResponse = await fetch(`${bridgeOrigin}/tts-cache`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bridgeAuthorizationHeader(settings?.bridgeApiToken),
        },
        body: JSON.stringify({ text: cleanText, settings: requestSettings }),
      });
      if (!cacheResponse.ok) throw new Error(`TTS cache failed: ${cacheResponse.status}`);
      const payload = await cacheResponse.json();
      if (!payload.audioUrl) throw new Error("TTS cache did not return audioUrl.");
      const audioUrl = `${bridgeOrigin}${payload.audioUrl}`;
      speechAudioUrlCache.set(speechCacheKey(cleanText, model), audioUrl);
      const audio = new Audio(audioUrl);
      activeSpeechAudio = audio;
      const ended = options?.waitForEnd ? waitForAudioEnd(audio) : Promise.resolve();
      await audio.play();
      await ended;
      return;
    } catch {
      // Fall through to direct API call, then browser voice.
    }

    try {
      const endpoint = requestSettings.ttsEndpoint?.trim() || `${requestSettings.baseURL.replace(/\/+$/, "")}/audio/speech`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requestSettings.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: cleanText,
        }),
      });
      if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      activeSpeechAudio = audio;
      audio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), { once: true });
      audio.addEventListener("error", () => URL.revokeObjectURL(audioUrl), { once: true });
      const ended = options?.waitForEnd ? waitForAudioEnd(audio) : Promise.resolve();
      await audio.play();
      await ended;
      return;
    } catch {
      // Fall back to the local browser voice.
    }
  }

  await speakWithBrowserVoice(cleanText, options);
}

async function prefetchEnglishAudioUrl(text: string, settings: AiSettings, ttsModel?: string): Promise<string | null> {
  const cleanText = text.trim();
  if (!cleanText) return null;
  const model = ttsModel || settings.ttsModel || defaultTtsModel;
  const cacheKey = speechCacheKey(cleanText, model);
  const cached = speechAudioUrlCache.get(cacheKey);
  if (cached) return cached;
  const apiSettings = settings.useApiTts !== false && settings.apiKey && (settings.ttsEndpoint || settings.baseURL) ? { ...settings, ttsModel: model } : null;
  if (!apiSettings) return null;

  try {
    const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
    const response = await fetch(`${bridgeOrigin}/tts-cache`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...bridgeAuthorizationHeader(settings.bridgeApiToken),
      },
      body: JSON.stringify({ text: cleanText, settings: apiSettings }),
    });
    if (!response.ok) throw new Error(`TTS cache failed: ${response.status}`);
    const payload = await response.json();
    if (payload.audioUrl) {
      const audioUrl = `${bridgeOrigin}${payload.audioUrl}`;
      speechAudioUrlCache.set(cacheKey, audioUrl);
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audio.load();
      return audioUrl;
    }
  } catch {
    // Fall back to direct TTS below when the local bridge cache is unavailable.
  }

  const endpoint = apiSettings.ttsEndpoint?.trim() || `${apiSettings.baseURL.replace(/\/+$/, "")}/audio/speech`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiSettings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: cleanText,
    }),
  });
  if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
  const audioUrl = URL.createObjectURL(await response.blob());
  speechAudioUrlCache.set(cacheKey, audioUrl);
  const audio = new Audio(audioUrl);
  audio.preload = "auto";
  audio.load();
  return audioUrl;
}

function SpeakButton({ text, label, settings }: { text: string; label?: string; settings?: AiSettings }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      className={`speak-button ${loading ? "loading" : ""}`}
      type="button"
      aria-label={label || `Play pronunciation for ${text}`}
      title={label || "Play pronunciation"}
      disabled={loading}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setLoading(true);
        void speakEnglish(text, settings).finally(() => setLoading(false));
      }}
    >
      {loading ? <Loader2 className="spin" /> : <Volume2 />}
    </button>
  );
}

function cardDisplayTags(card: Card): string[] {
  return visibleTags(card.tags, {
    topic: card.topic,
    partOfSpeech: card.partOfSpeech,
  });
}

function defaultSuggestions(card: Card): string[] {
  return [
    `Explain "${card.word}" briefly.`,
    `Give 2 TOEIC examples.`,
    `Show common confusion.`,
  ];
}

function globalSuggestions({
  contextScope,
  contextDescription,
  selectedWord,
  wordCount,
}: {
  contextScope: GlobalContextScope;
  contextDescription: string;
  selectedWord?: string;
  wordCount: number;
}): string[] {
  if (contextScope.mode === "custom") {
    if (selectedWord) {
      return [
        `Compare "${selectedWord}" with traps in my custom list.`,
        "Quiz me on my custom selected words.",
        "Make a study plan for my custom selected words.",
      ];
    }
    return [
      "Quiz me on my custom selected words.",
      "Find confusing pairs in my custom list.",
      "Make a study plan for my custom selected words.",
    ];
  }

  if (contextScope.mode === "created") {
    return [
      `Quiz me on words from ${contextDescription}.`,
      `Find confusing words from ${contextDescription}.`,
      `Make a review plan for ${contextDescription}.`,
    ];
  }

  if (contextScope.mode === "topic" && contextScope.topic !== "all") {
    return [
      `Quiz me on ${contextScope.topic} vocabulary.`,
      `Find TOEIC traps in ${contextScope.topic}.`,
      `Make a ${contextScope.topic} study plan.`,
    ];
  }

  if (contextScope.mode === "level" && contextScope.level !== "all") {
    return [
      `Quiz me on ${cardLevelLabels[contextScope.level]} words.`,
      `Find weak spots in my ${cardLevelLabels[contextScope.level]} words.`,
      `Make a review plan for my ${cardLevelLabels[contextScope.level]} words.`,
    ];
  }

  return [
    `Quiz me across all ${wordCount.toLocaleString()} words.`,
    "Find confusing word groups.",
    "Make a full vocabulary study plan.",
  ];
}

function normalizeGlobalSuggestions(items: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  return items
    .map((item) => String(item || "").trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length >= 8 && item.length <= 140)
    .concat(fallback)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function parseSuggestionText(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    const items = Array.isArray(parsed) ? parsed : parsed.suggestions;
    if (Array.isArray(items)) return items;
  } catch {
    // Fall back to line parsing for models that ignore JSON-only instructions.
  }

  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
}

function escapeRawControlCharsInStrings(jsonStr: string): string {
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

function parseJsonPayload<T>(value: string): T {
  const sanitized = escapeRawControlCharsInStrings(value);
  const trimmed = sanitized.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error("Response was not JSON.");
  }
}

function normalizeConversationVoiceAssignments(
  speakers: string[],
  assignments: Record<string, string> | undefined,
  settings: AiSettings,
): Record<string, string> {
  const availableVoiceIds = new Set(ttsVoiceOptions.map((voice) => voice.value));
  const fallbackVoices = [
    settings.conversationVoiceA || defaultTtsModel,
    settings.conversationVoiceB || defaultSettings.conversationVoiceB,
    settings.conversationVoiceC || defaultSettings.conversationVoiceC,
  ];
  return Object.fromEntries(
    speakers.map((speaker, index) => {
      const assigned = settings.conversationAutoSelectVoices ? assignments?.[speaker] : undefined;
      const usableAssigned = assigned && availableVoiceIds.has(assigned) ? assigned : undefined;
      return [speaker, usableAssigned || fallbackVoices[index % fallbackVoices.length] || defaultTtsModel];
    }),
  );
}

function normalizeDailyConversation(value: string, settings: AiSettings): DailyConversation {
  const parsed = parseJsonPayload<Partial<DailyConversation>>(value);
  const rawFormat = String(parsed.format || "").trim().toLowerCase();
  const format = ["dialogue", "group_chat", "interview"].includes(rawFormat)
    ? "conversation"
    : ["conversation", "radio", "announcement", "story"].includes(rawFormat)
      ? (rawFormat as Exclude<ConversationFormat, "auto">)
      : undefined;
  const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const lines = rawLines
    .map((line, index) => ({
      id: String(line.id || `line-${index + 1}`),
      speaker: String(line.speaker || "").trim(),
      text: String(line.text || "").trim(),
      translation: line.translation ? String(line.translation).trim() : undefined,
      vocabulary: Array.isArray(line.vocabulary) ? line.vocabulary.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5) : [],
      vocabularyMeanings:
        line.vocabularyMeanings && typeof line.vocabularyMeanings === "object"
          ? Object.fromEntries(
              Object.entries(line.vocabularyMeanings)
                .map(([term, meaning]) => [String(term || "").trim(), String(meaning || "").trim()] as const)
                .filter(([term, meaning]) => term && meaning),
            )
          : undefined,
    }))
    .filter((line) => line.speaker && line.text)
    .slice(0, 12);
  const rawSpeakers = Array.isArray(parsed.speakers) ? parsed.speakers : [];
  const speakers = Array.from(new Set([...rawSpeakers, ...lines.map((line) => line.speaker)].map((speaker) => String(speaker || "").trim()).filter(Boolean))).slice(0, 4);
  if (!lines.length || speakers.length < 1) throw new Error("Conversation needs at least one speaker and one line.");
  const voiceAssignments = normalizeConversationVoiceAssignments(
    speakers,
    parsed.voiceAssignments && typeof parsed.voiceAssignments === "object" ? parsed.voiceAssignments : undefined,
    settings,
  );
  return {
    type: "daily_conversation",
    format,
    title: String(parsed.title || "Daily conversation").trim(),
    context: parsed.context ? String(parsed.context).trim() : undefined,
    speakers,
    voiceAssignments,
    lines,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function conversationPartOfSpeechClass(partOfSpeech?: string): string {
  const normalized = String(partOfSpeech || "").toLowerCase();
  if (normalized.includes("verb")) return "pos-verb";
  if (normalized.includes("adjective") || normalized === "adj") return "pos-adjective";
  if (normalized.includes("adverb") || normalized === "adv") return "pos-adverb";
  if (normalized.includes("noun")) return "pos-noun";
  if (normalized.includes("preposition")) return "pos-preposition";
  if (normalized.includes("phrase") || normalized.includes("idiom") || normalized.includes("collocation")) return "pos-phrase";
  return "pos-other";
}

function renderHighlightedVocabulary(text: string, vocabulary: string[] = [], vocabularyPartOfSpeech: Record<string, string> = {}) {
  const terms = vocabulary.map((term) => term.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, index) => {
    const matchedTerm = terms.find((term) => term.toLowerCase() === part.toLowerCase());
    const isVocabulary = Boolean(matchedTerm);
    return isVocabulary ? (
      <mark
        key={`${part}-${index}`}
        className={`conversation-vocabulary-mark ${conversationPartOfSpeechClass(vocabularyPartOfSpeech[matchedTerm?.toLowerCase() || ""])}`}
      >
        {part}
      </mark>
    ) : (
      part
    );
  });
}

function renderTranslationWithVocabularyMeanings(translation: string, meanings: Record<string, string> = {}) {
  const phrases = Object.values(meanings)
    .map((meaning) => meaning.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!phrases.length) return translation;
  const pattern = new RegExp(`(${phrases.map(escapeRegExp).join("|")})`, "gi");
  return translation.split(pattern).map((part, index) => {
    const isMeaning = phrases.some((phrase) => phrase.toLowerCase() === part.toLowerCase());
    return isMeaning ? (
      <em key={`${part}-${index}`} className="conversation-translation-meaning">
        {part}
      </em>
    ) : (
      part
    );
  });
}

function conversationUnitText(lines: ConversationLine[]): string {
  return lines.map((line) => line.text.trim()).filter(Boolean).join("\n\n");
}

function buildConversationIntroUnit(conversation: DailyConversation): ConversationPlaybackUnit | null {
  const title = conversation.title.trim();
  const context = String(conversation.context || "").trim();
  const text = [title, context].filter(Boolean).join(". ");
  if (!text) return null;
  return {
    ids: [`intro:${title}`],
    speaker: conversation.speakers[0] || conversation.lines[0]?.speaker || "Narrator",
    text,
  };
}

function buildConversationPlaybackUnits(conversation: DailyConversation): ConversationPlaybackUnit[] {
  const format = conversation.format || "conversation";
  const lines = conversation.lines.filter((line) => line.text.trim());
  if (!lines.length) return [];

  if (format === "story" || format === "announcement" || (format === "radio" && conversation.speakers.length <= 1)) {
    return [
      {
        ids: lines.map((line) => line.id),
        speaker: lines[0].speaker,
        text: conversationUnitText(lines),
      },
    ];
  }

  const units: ConversationPlaybackUnit[] = [];
  for (const line of lines) {
    const previous = units[units.length - 1];
    if (previous && previous.speaker === line.speaker) {
      previous.ids.push(line.id);
      previous.text = `${previous.text}\n\n${line.text.trim()}`;
    } else {
      units.push({ ids: [line.id], speaker: line.speaker, text: line.text.trim() });
    }
  }
  return units;
}

function isQuizRequest(value: string): boolean {
  return /\b(quiz|quick quiz|test me|practice|missing word|fill[- ]?in|check me)\b/i.test(value);
}

function extractRecentQuizAnswers(messages: ChatMessage[], limit = 16): string[] {
  const seen = new Set<string>();
  const answers: string[] = [];

  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const quiz = maybeParseQuickQuiz(message.content);
    if (!quiz) continue;
    for (const question of quiz.questions) {
      const answer = question.answer.trim();
      const key = normalizeAnswer(answer);
      if (!answer || seen.has(key)) continue;
      seen.add(key);
      answers.push(answer);
      if (answers.length >= limit) return answers;
    }
  }

  return answers;
}

function formatReadingLine(line: string, format: ReadingFormat): string {
  if (format !== "part6") return line;
  return line.replace(/\[(\d+)](?!\s*_{2,})/g, "[$1] _____");
}

function normalizeSuggestions(items: string[], card: Card): string[] {
  const seen = new Set<string>();
  return items
    .map((item) => String(item || "").trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item.length >= 8 && item.length <= 120)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .concat(defaultSuggestions(card))
    .filter((item, index, all) => all.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 3);
}

function shortSuggestionLabel(value: string): string {
  const words = value.replace(/[?!.]+$/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4) return words.join(" ");
  return `${words.slice(0, 4).join(" ")}...`;
}

function renderInlineText(value: string) {
  const parts = value.split(/(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("***") && part.endsWith("***")) {
      return (
        <strong key={index}>
          <em>{part.slice(3, -3)}</em>
        </strong>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return <span key={index}>{part}</span>;
  });
}

function renderInlineLines(value: string) {
  return value.split("\n").map((line, index) => (
    <span key={`${line}-${index}`}>
      {index ? <br /> : null}
      {renderInlineText(line)}
    </span>
  ));
}

function parseTableRow(line: string): string[] {
  return line.replace(/^\s*\|?|\|?\s*$/g, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function MarkdownText({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);
  const nodes = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let orderedList: string[] = [];
  let tableRows: string[][] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    nodes.push(
      <p key={`p-${nodes.length}`}>
        {paragraph.map((line, index) => (
          <span key={`${line}-${index}`}>
            {index ? <br /> : null}
            {renderInlineText(line)}
          </span>
        ))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={`ul-${nodes.length}`}>
          {list.map((line, index) => (
            <li key={`${line}-${index}`}>{renderInlineLines(line)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (orderedList.length) {
      nodes.push(
        <ol key={`ol-${nodes.length}`}>
          {orderedList.map((line, index) => (
            <li key={`${line}-${index}`}>{renderInlineLines(line)}</li>
          ))}
        </ol>,
      );
      orderedList = [];
    }
  };

  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows.forEach((row) => paragraph.push(`| ${row.join(" | ")} |`));
      tableRows = [];
      return;
    }

    const [head, ...body] = tableRows;
    nodes.push(
      <div className="markdown-table-wrap" key={`table-${nodes.length}`}>
        <table>
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th key={`${cell}-${index}`}>{renderInlineText(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${cell}-${cellIndex}`}>{renderInlineText(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushTable();
      if (!list.length && !orderedList.length) {
        flushList();
      }
      continue;
    }

    if (isTableSeparator(line)) {
      continue;
    }

    if (line.includes("|") && /^\|?[^|]+\|/.test(line)) {
      flushParagraph();
      flushList();
      tableRows.push(parseTableRow(line));
      continue;
    }

    flushTable();

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const Tag = heading[1].length <= 2 ? "h3" : "h4";
      nodes.push(<Tag key={`h-${nodes.length}`}>{renderInlineText(heading[2])}</Tag>);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      orderedList = [];
      list.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      list = [];
      orderedList.push(ordered[1]);
      continue;
    }

    const isListContinuation = /^\s{2,}/.test(rawLine) || /^[→=]/.test(line);
    if (isListContinuation && (list.length || orderedList.length)) {
      if (orderedList.length) {
        orderedList[orderedList.length - 1] = `${orderedList[orderedList.length - 1]}\n${line}`;
      } else {
        list[list.length - 1] = `${list[list.length - 1]}\n${line}`;
      }
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushTable();

  return (
    <>
      {nodes}
    </>
  );
}

export function App() {
  const { cards: manifestCards, manifest, loading, refreshing, error, lastLoadedAt, refresh } = useManifest();
  const [theme, setTheme] = useStoredState<Theme>("voca.theme", "light");
  const [storedSettings, setSettings] = useStoredState<AiSettings>("voca.ai.settings", defaultSettings);
  const [layout, setLayout] = useStoredState<LayoutColumns>("voca.layout.columns", defaultLayout);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [createCardState, setCreateCardState] = useState<CreateCardState>({ word: "", status: "idle", message: "" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [globalAgentOpen, setGlobalAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const [tasksOpen, setTasksOpen] = useState(false);
  const tasksDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tasksDropdownRef.current && !tasksDropdownRef.current.contains(event.target as Node)) {
        setTasksOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const clearCompletedTasks = () => {
    setTasks((prev) => prev.filter((t) => t.status === "processing"));
  };

  const [contextScope, setContextScope] = useStoredState<GlobalContextScope>("voca.globalAgent.contextScope", defaultGlobalContextScope);
  const settings = useMemo(
    () => ({
      ...defaultSettings,
      ...storedSettings,
      bridgeApiToken: storedSettings.bridgeApiToken?.trim() || defaultSettings.bridgeApiToken,
    }),
    [storedSettings],
  );

  const handleSettingsChange = (newSettings: AiSettings) => {
    setSettings(newSettings);
    if (newSettings.searchMode !== settings.searchMode) {
      const bridgeOrigin = resolvedLocalBridgeOrigin(newSettings.localBridgeOrigin);
      fetch(`${bridgeOrigin}/v1/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bridgeAuthorizationHeader(newSettings.bridgeApiToken),
        },
        body: JSON.stringify({ searchMode: newSettings.searchMode }),
      }).catch((err) => {
        console.error("Failed to save searchMode on server:", err);
      });
    }
  };

  const searchMode = settings.searchMode || "default";

  /** Library levels come only from the manifest (cards.json via /cards.json or bridge /v1/cards)—no browser-only overrides. */
  const cards = manifestCards;
  const topics = useMemo(() => uniqueSortedValues(cards, "topic"), [cards]);
  const partsOfSpeech = useMemo(() => uniqueSortedValues(cards, "partOfSpeech"), [cards]);
  const filtered = useMemo(() => sortCardsByCreatedNewest(filterCards(cards, filters)), [cards, filters]);
  const activeContextScope: GlobalContextScope = {
    ...defaultGlobalContextScope,
    ...contextScope,
    mode: contextScope.mode === "today" ? "created" : contextScope.mode,
    createdDate: contextScope.createdDate || (contextScope.mode === "today" ? "today" : defaultGlobalContextScope.createdDate),
    customKeys: Array.isArray(contextScope.customKeys) ? contextScope.customKeys : [],
  };
  const prioritizedCards = useMemo(() => sortCardsByLearningPriority(cards), [cards]);
  const customKeySet = useMemo(() => new Set(activeContextScope.customKeys), [activeContextScope.customKeys]);
  const scopedCards = useMemo(() => {
    let nextCards = prioritizedCards;
    if (activeContextScope.mode === "created") {
      nextCards = nextCards.filter((card) => isCardInCreatedDateScope(card, activeContextScope.createdDate));
    } else if (activeContextScope.mode === "topic" && activeContextScope.topic !== "all") {
      nextCards = nextCards.filter((card) => canonicalTopic(card.topic) === activeContextScope.topic);
    } else if (activeContextScope.mode === "level" && activeContextScope.level !== "all") {
      nextCards = nextCards.filter((card) => card.level === activeContextScope.level);
    } else if (activeContextScope.mode === "custom") {
      nextCards = nextCards.filter((card) => customKeySet.has(cardKey(card)));
    }
    return nextCards;
  }, [activeContextScope.createdDate, activeContextScope.level, activeContextScope.mode, activeContextScope.topic, customKeySet, prioritizedCards]);
  const activeVocabularyIndex = useMemo(() => scopedCards.map((card) => card.word), [scopedCards]);
  const contextDescription = useMemo(() => {
    if (activeContextScope.mode === "created") return createdDateLabel(activeContextScope.createdDate);
    if (activeContextScope.mode === "topic") return `Topic: ${activeContextScope.topic === "all" ? "All topics" : activeContextScope.topic}`;
    if (activeContextScope.mode === "level") return `Status: ${activeContextScope.level === "all" ? "All statuses" : cardLevelLabels[activeContextScope.level]}`;
    if (activeContextScope.mode === "custom") return "Custom selected words";
    return "All words";
  }, [activeContextScope.createdDate, activeContextScope.level, activeContextScope.mode, activeContextScope.topic]);
  const contextListCards = useMemo(() => {
    if (!globalAgentOpen) return filtered;
    if (activeContextScope.mode === "custom") {
      return sortCardsByCreatedNewest(filterCards(prioritizedCards, filters));
    }
    return sortCardsByCreatedNewest(filterCards(scopedCards, filters));
  }, [activeContextScope.mode, filtered, filters, globalAgentOpen, prioritizedCards, scopedCards]);
  const selected = useMemo(
    () => cards.find((card) => cardKey(card) === selectedKey) || null,
    [cards, selectedKey],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const fetchServerSettings = async () => {
      try {
        const bridgeOrigin = resolvedLocalBridgeOrigin(storedSettings.localBridgeOrigin);
        const response = await fetch(`${bridgeOrigin}/v1/settings`, {
          headers: bridgeAuthorizationHeader(storedSettings.bridgeApiToken),
        });
        if (response.ok) {
          const data = await response.json();
          if (data) {
            if (data.searchMode === "default" || data.searchMode === "idioms") {
              setSettings((prev) => {
                if (prev.searchMode === data.searchMode) return prev;
                return { ...prev, searchMode: data.searchMode };
              });
            } else if (data.searchMode === null) {
              // Server is uninitialized, initialize it with the client's current mode
              void fetch(`${bridgeOrigin}/v1/settings`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...bridgeAuthorizationHeader(storedSettings.bridgeApiToken),
                },
                body: JSON.stringify({ searchMode: storedSettings.searchMode || "default" }),
              }).catch((err) => {
                console.error("Failed to initialize server settings:", err);
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch server settings:", err);
      }
    };
    void fetchServerSettings();
  }, [storedSettings.localBridgeOrigin, storedSettings.bridgeApiToken]);

  useEffect(() => {
    if (selectedKey && !selected) {
      setSelectedKey(null);
      setChatOpen(false);
    }
  }, [selected, selectedKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q && cards.length > 0) {
      const cleanQ = q.trim();
      setFilters((prev) => ({ ...prev, query: cleanQ }));
      const matched = cards.find(
        (c) => c.word.toLowerCase() === cleanQ.toLowerCase() || (c.slug && c.slug.toLowerCase() === cleanQ.toLowerCase())
      );
      if (matched) {
        setSelectedKey(cardKey(matched));
      }
      // Clean query parameter from URL bar to prevent sticky search on refresh
      try {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
      } catch (e) {
        console.error("Failed to clean search URL:", e);
      }
    }
  }, [cards]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isInputFocused =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.getAttribute("contenteditable") === "true";

      // 1. Focus Search: '/' (when not focused) or 'Cmd+K' / 'Ctrl+K'
      if (event.key === "/" && !isInputFocused) {
        event.preventDefault();
        const searchInput = document.querySelector(".search-box input") as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const searchInput = document.querySelector(".search-box input") as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // 2. Clear query: Esc
      if (event.key === "Escape") {
        const searchInput = document.querySelector(".search-box input") as HTMLInputElement | null;
        if (searchInput && document.activeElement === searchInput) {
          event.preventDefault();
          if (filters.query !== "") {
            setFilters((prev) => ({ ...prev, query: "" }));
          } else {
            searchInput.blur();
          }
        } else if (filters.query) {
          event.preventDefault();
          setFilters((prev) => ({ ...prev, query: "" }));
        }
        return;
      }

      // 3. Speak: Alt+V, Alt+P, Ctrl+Space, or Alt+Enter (if search input focused), or '\' (if not focused)
      const isSpeakShortcut =
        (event.altKey && (event.key.toLowerCase() === "v" || event.key.toLowerCase() === "p")) ||
        (event.ctrlKey && event.key === " ") ||
        (event.altKey && event.key === "Enter" && document.activeElement === document.querySelector(".search-box input")) ||
        (event.key === "\\" && !isInputFocused);

      if (isSpeakShortcut) {
        event.preventDefault();
        const targetWord = selected?.word || contextListCards[0]?.word;
        if (targetWord) {
          void speakEnglish(targetWord, settings);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selected, contextListCards, filters, settings]);

  const clearFilters = () => setFilters(defaultFilters);
  const createMissingCard = async (word: string) => {
    const normalizedWord = word.trim();
    if (!normalizedWord || createCardState.status === "creating") return;
    if (!settings.baseURL || !settings.apiKey || !settings.model) {
      setCreateCardState({
        word: normalizedWord,
        status: "error",
        message: "Configure LLM settings first.",
      });
      return;
    }

    const mainTaskId = `task-${normalizedWord}-${Date.now()}`;
    const searchModeIsIdioms = settings.searchMode === "idioms";
    setTasks((prev) => [
      ...prev,
      {
        id: mainTaskId,
        word: searchModeIsIdioms ? `Idioms for "${normalizedWord}"` : normalizedWord,
        status: "processing",
        message: "Preparing...",
        updatedAt: Date.now(),
      },
    ]);
    setTasksOpen(true);

    setCreateCardState({ word: normalizedWord, status: "creating", message: "Preparing card..." });
    const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);

    try {
      const response = await fetch(`${bridgeOrigin}/create-card`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bridgeAuthorizationHeader(settings.bridgeApiToken),
        },
        body: JSON.stringify({ word: normalizedWord, settings }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Create card failed (${response.status})`);
      }
      if (!response.body) {
        throw new Error("Create card response did not include a progress stream.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMessage = "";
      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let event: CreateCardEvent;
        try {
          event = JSON.parse(trimmed);
        } catch {
          event = { type: "log", message: trimmed };
        }
        if (event.type === "error") {
          throw new Error(event.message || "Cannot create card.");
        }
        if (event.type === "done") {
          finalMessage = event.message || "Completed";
          return;
        }
        if (event.type === "progress" && event.message) {
          setCreateCardState({
            word: normalizedWord,
            status: "creating",
            message: event.message,
          });

          const match = event.message.match(/^\[(.*?)\]\s*(.*)$/);
          if (match) {
            const taskWord = match[1];
            const taskMsg = match[2];
            setTasks((prev) => {
              const taskIndex = prev.findIndex((t) => t.word === taskWord && t.status === "processing");
              if (taskIndex >= 0) {
                return prev.map((t, idx) =>
                  idx === taskIndex ? { ...t, message: taskMsg, updatedAt: Date.now() } : t
                );
              } else {
                return [
                  ...prev,
                  {
                    id: `sub-${taskWord}-${Date.now()}`,
                    word: taskWord,
                    status: "processing",
                    message: taskMsg,
                    updatedAt: Date.now(),
                  },
                ];
              }
            });
          } else {
            const currentMsg = event.message || "";
            setTasks((prev) =>
              prev.map((t) =>
                t.id === mainTaskId ? { ...t, message: currentMsg, updatedAt: Date.now() } : t
              )
            );
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          handleLine(line);
        }
      }
      buffer += decoder.decode();
      handleLine(buffer);

      setCreateCardState({
        word: normalizedWord,
        status: "done",
        message: finalMessage || "Card creation complete.",
      });

      setTasks((prev) =>
        prev.map((t) =>
          t.id === mainTaskId || (t.id.startsWith("sub-") && t.status === "processing")
            ? { ...t, status: "completed", message: "Completed successfully!", updatedAt: Date.now() }
            : t
        )
      );

      await refresh("manual");
      setFilters((current) => ({ ...current, query: normalizedWord }));
    } catch (error) {
      const errMsg =
        error instanceof Error && error.message.includes("Failed to fetch")
          ? "Open or relaunch VocaMenuBar to enable card creation. Fallback: npm run voca:api."
          : error instanceof Error
            ? error.message
            : "Cannot create card.";

      setCreateCardState({
        word: normalizedWord,
        status: "error",
        message: errMsg,
      });

      setTasks((prev) =>
        prev.map((t) =>
          t.id === mainTaskId || (t.id.startsWith("sub-") && t.status === "processing")
            ? {
                ...t,
                status: "failed",
                message: error instanceof Error ? error.message : "Failed to create",
                updatedAt: Date.now(),
              }
            : t
        )
      );
    }
  };

  const handleFilterSearchCommandEnter = () => {
    const query = filters.query.trim();
    if (!query) return;

    if (searchMode === "idioms") {
      if (createCardState.status !== "creating") {
        void createMissingCard(query);
      }
      return;
    }

    if (query.includes(",")) return;

    if (contextListCards.length > 0) {
      const targetWord = selected?.word || contextListCards[0]?.word;
      if (targetWord) {
        void speakEnglish(targetWord, settings);
      }
    } else {
      const exactExists = cards.some((c) => c.word.toLowerCase() === query.toLowerCase());
      if (!exactExists && createCardState.status !== "creating") {
        void createMissingCard(query);
      }
    }
  };
  const updateContextScope = (next: Partial<GlobalContextScope>) => {
    setContextScope((current) => ({
      ...defaultGlobalContextScope,
      ...current,
      ...next,
      customKeys: Array.isArray(next.customKeys ?? current.customKeys) ? (next.customKeys ?? current.customKeys) : [],
    }));
  };
  const toggleCustomContextCard = (card: Card) => {
    const key = cardKey(card);
    setContextScope((current) => {
      const keys = new Set(Array.isArray(current.customKeys) ? current.customKeys : []);
      if (keys.has(key)) {
        keys.delete(key);
      } else {
        keys.add(key);
      }
      return {
        ...current,
        customKeys: [...keys],
      };
    });
  };
  const setCardLevel = (card: Card, level: CardLevel) => {
    const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
    const cardId = String(card.slug || slugify(card.word)).trim() || cardKey(card);
    void patchBridgeCardLevel(bridgeOrigin, cardId, level, { authToken: settings.bridgeApiToken })
      .then(() => refresh())
      .catch((err) => {
        console.error("[voca] bridge level sync failed (cards.json unchanged):", err);
      });
  };
  const deleteCard = (card: Card) => {
    const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
    const cardId = String(card.slug || slugify(card.word)).trim() || cardKey(card);
    fetch(`${bridgeOrigin}/v1/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
      headers: {
        ...bridgeAuthorizationHeader(settings.bridgeApiToken),
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res.json();
      })
      .then(() => {
        setSelectedKey(null);
        setChatOpen(false);
        void refresh();
      })
      .catch((err) => {
        console.error("[voca] delete card failed:", err);
        alert(err instanceof Error ? err.message : "Failed to delete card");
      });
  };


  const startResize = (splitter: "list" | "preview", event: ReactPointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const start = layout;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      if (splitter === "list") {
        setLayout({
          ...start,
          list: Math.max(340, Math.min(760, start.list + dx)),
        });
        return;
      }
      setLayout({
        ...start,
        chat: Math.max(340, Math.min(640, start.chat - dx)),
      });
    };

    const onUp = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    document.body.classList.add("resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <main
      className={`app-shell ${globalAgentOpen ? "global-agent-open" : ""} ${selected && !globalAgentOpen ? "preview-open" : ""} ${
        chatOpen && !globalAgentOpen ? "chat-open" : ""
      }`}
      style={{
        "--list-col": `${layout.list}px`,
        "--preview-col": `${layout.preview}px`,
        "--chat-col": `${layout.chat}px`,
      } as CSSProperties}
    >
      <section className="dictionary-panel" aria-label="Dictionary list">
        <header className="list-heading">
          <div>
            <h1>Voca Dictionary</h1>
            <p>
              {cards.length.toLocaleString()} cards · {contextListCards.length.toLocaleString()} shown · updated {formatTime(lastLoadedAt)}
            </p>
            {globalAgentOpen ? <p className="list-context-note">Agent context: {contextDescription}</p> : null}
          </div>
          <div className="list-actions">
            <button
              className={`icon-button ${shortcutsOpen ? "active" : ""}`}
              type="button"
              onClick={() => setShortcutsOpen(!shortcutsOpen)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
            >
              <Keyboard />
            </button>
            <div className="task-indicator-container" ref={tasksDropdownRef}>
              <button
                className={`icon-button ${tasksOpen ? "active" : ""}`}
                type="button"
                onClick={() => setTasksOpen(!tasksOpen)}
                aria-label="Active card generation tasks"
                title="Active tasks"
              >
                {tasks.some((t) => t.status === "processing") ? (
                  <Activity className="spin-icon" style={{ color: "var(--text-link)" }} />
                ) : (
                  <Activity />
                )}
                {tasks.filter((t) => t.status === "processing").length > 0 && (
                  <span className="task-badge">{tasks.filter((t) => t.status === "processing").length}</span>
                )}
              </button>

              {tasksOpen && (
                <div className="tasks-dropdown-panel">
                  <div className="tasks-dropdown-header">
                    <h3>Generation Tasks</h3>
                    {tasks.length > 0 && (
                      <button className="clear-tasks-btn" onClick={clearCompletedTasks}>
                        Clear Finished
                      </button>
                    )}
                  </div>
                  <div className="tasks-list">
                    {tasks.length === 0 ? (
                      <div className="tasks-empty">No active tasks.</div>
                    ) : (
                      [...tasks].reverse().map((task) => (
                        <div className="task-item" key={task.id}>
                          <div className={`task-icon ${task.status}`}>
                            {task.status === "processing" && <Loader2 className="spin" size={14} />}
                            {task.status === "completed" && <CheckCircle2 size={14} />}
                            {task.status === "failed" && <XCircle size={14} />}
                            {task.status === "pending" && <Clock size={14} />}
                          </div>
                          <div className="task-details">
                            <span className="task-title" title={task.word}>{task.word}</span>
                            <span className="task-msg" title={task.message}>{task.message}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              className="icon-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              title="Settings"
            >
              <Settings />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => refresh("manual")}
              aria-label="Refresh data"
              title="Refresh data"
              disabled={refreshing}
            >
              <RefreshCw className={refreshing ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
          </div>
        </header>

        <FilterBar
          filters={filters}
          topics={topics}
          partsOfSpeech={partsOfSpeech}
          onChange={setFilters}
          onClear={clearFilters}
          onCommandEnter={handleFilterSearchCommandEnter}
        />

        {error ? <div className="notice error">{error}</div> : null}
        {loading ? (
          <div className="notice">Loading cards...</div>
        ) : (
          <CardList
            cards={contextListCards}
            selectedKey={selectedKey}
            selectedKeys={globalAgentOpen && activeContextScope.mode === "custom" ? customKeySet : undefined}
            quickPreviewEnabled={globalAgentOpen}
            settings={settings}
            compact={Boolean(selected && !globalAgentOpen)}
            searchQuery={filters.query}
            createCardState={createCardState}
            onCreateMissing={createMissingCard}
            searchMode={searchMode}
            onSelect={(card) => {
              if (globalAgentOpen && activeContextScope.mode === "custom") {
                toggleCustomContextCard(card);
                return;
              }
              setSelectedKey(cardKey(card));
            }}
          />
        )}
      </section>

      <Splitter visible={Boolean(selected && !globalAgentOpen)} label="Resize vocabulary list and preview" onPointerDown={(event) => startResize("list", event)} />

      {selected && !globalAgentOpen ? (
        <CardPreview
          card={selected}
          manifestSource={manifest?.source || "legacy"}
          onLevelChange={(level) => setCardLevel(selected, level)}
          onDeleteCard={deleteCard}
          settings={settings}
          onClose={() => {
            setSelectedKey(null);
            setChatOpen(false);
          }}
          onOpenChat={() => setChatOpen(true)}
        />
      ) : null}

      <Splitter visible={chatOpen && !globalAgentOpen} label="Resize preview and Agent Assistant" onPointerDown={(event) => startResize("preview", event)} />

      {chatOpen && selected && !globalAgentOpen ? (
        <ChatPanel
          card={selected}
          settings={settings}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
      {!globalAgentOpen ? (
      <button className="global-agent-fab" type="button" onClick={() => setGlobalAgentOpen(true)} aria-label="Open global agent">
        <Sparkles />
      </button>
      ) : null}
      {globalAgentOpen ? (
        <GlobalAgentPanel
          cards={cards}
          contextScope={activeContextScope}
          contextTopics={topics}
          activeVocabularyIndex={activeVocabularyIndex}
          contextDescription={contextDescription}
          onContextScopeChange={updateContextScope}
          selectedWord={selected?.word}
          settings={settings}
          onClose={() => setGlobalAgentOpen(false)}
        />
      ) : null}
      {settingsOpen ? (
        <AppSettingsPanel
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onClose={() => setSettingsOpen(false)}
          cards={manifestCards}
          onRefresh={refresh}
        />
      ) : null}
      {shortcutsOpen ? (
        <KeyboardShortcutsHelp onClose={() => setShortcutsOpen(false)} />
      ) : null}
    </main>
  );
}

function Splitter({
  visible,
  label,
  onPointerDown,
}: {
  visible: boolean;
  label: string;
  onPointerDown: (event: ReactPointerEvent) => void;
}) {
  return (
    <div
      className={`splitter ${visible ? "visible" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      <GripVertical />
    </div>
  );
}

function AppSettingsPanel({
  settings,
  onSettingsChange,
  onClose,
  cards,
  onRefresh,
}: {
  settings: AiSettings;
  onSettingsChange: (settings: AiSettings) => void;
  onClose: () => void;
  cards: Card[];
  onRefresh: () => void;
}) {
  const [testingVoice, setTestingVoice] = useState(false);
  const [testingConversationVoice, setTestingConversationVoice] = useState<"A" | "B" | "C" | null>(null);
  
  const [fillingMeanings, setFillingMeanings] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  const [totalToFill, setTotalToFill] = useState(0);
  const [fillingStatus, setFillingStatus] = useState<string | null>(null);

  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [clearAllInput, setClearAllInput] = useState("");
  const [clearingAll, setClearingAll] = useState(false);

  const handleClearAll = async () => {
    if (clearAllInput !== "CLEAR ALL" || clearingAll) return;
    setClearingAll(true);
    const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
    try {
      const response = await fetch(`${bridgeOrigin}/v1/cards`, {
        method: "DELETE",
        headers: {
          ...bridgeAuthorizationHeader(settings.bridgeApiToken),
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `DELETE failed with status ${response.status}`);
      }
      setConfirmingClearAll(false);
      setClearAllInput("");
      onRefresh();
      alert("Đã xóa toàn bộ từ vựng thành công!");
    } catch (err) {
      console.error("[voca] clear all cards failed:", err);
      alert(err instanceof Error ? err.message : "Failed to clear all vocabulary");
    } finally {
      setClearingAll(false);
    }
  };


  const missingCards = useMemo(() => {
    return cards.filter((card) => !card.meaningVi || !card.meaningEn);
  }, [cards]);

  const handleFillMissingMeanings = async () => {
    if (fillingMeanings) return;
    if (!settings.baseURL || !settings.apiKey || !settings.model) {
      setFillingStatus("Please configure LLM settings first.");
      return;
    }

    const missing = cards.filter((card) => !card.meaningVi || !card.meaningEn);
    if (missing.length === 0) {
      setFillingStatus("All cards already have meanings!");
      return;
    }

    setFillingMeanings(true);
    setFilledCount(0);
    setTotalToFill(missing.length);
    setFillingStatus("Starting meaning auto-fill...");

    // Group into batches of 10
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      batches.push(missing.slice(i, i + BATCH_SIZE));
    }

    const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
    let allUpdates: Array<{ word: string; meaningEn: string; meaningVi: string }> = [];

    try {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        setFillingStatus(`Querying AI for batch ${i + 1}/${batches.length}...`);

        const prompt = `Provide compact, TOEIC-focused English and Vietnamese meanings for the following vocabulary items.
Rules:
- meaningEn must be a short, clear definition in simple English.
- meaningVi must be a natural, concise Vietnamese translation.
- Ensure the definitions fit the specified part of speech and topic context.

Return ONLY a JSON object containing the updates in this exact schema:
{
  "updates": [
    {
      "word": "stood out",
      "meaningEn": "to be easily noticeable or significantly better than others",
      "meaningVi": "nổi bật, xuất sắc hơn"
    }
  ]
}

Words to define:
${batch.map((c) => `- Word: "${c.word}", Part of speech: "${c.partOfSpeech}", Topic: "${c.topic}"`).join("\n")}`;

        const response = await fetchLlm(settings, {
          model: settings.model,
          stream: false,
          messages: [
            {
              role: "system",
              content: "You are a professional English-Vietnamese TOEIC dictionary assistant. You must return only valid JSON matching the requested schema.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        });

        if (!response.ok) {
          throw new Error(`AI API returned error (${response.status})`);
        }

        const data = await response.json();
        const content = extractLlmResponseText(data);
        const parsed = JSON.parse(content);
        if (!parsed || !Array.isArray(parsed.updates)) {
          throw new Error("Invalid response format from AI.");
        }

        allUpdates = [...allUpdates, ...parsed.updates];
        setFilledCount((prev) => Math.min(missing.length, prev + batch.length));
      }

      setFillingStatus("Sending generated meanings to bridge...");
      const saveResponse = await fetch(`${bridgeOrigin}/fill-meanings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bridgeAuthorizationHeader(settings.bridgeApiToken),
        },
        body: JSON.stringify({ updates: allUpdates }),
      });

      if (!saveResponse.ok) {
        const payload = await saveResponse.json().catch(() => ({}));
        throw new Error(payload.error || `Save meanings failed (${saveResponse.status})`);
      }

      const saveResult = await saveResponse.json();
      setFillingStatus(`Successfully filled ${saveResult.updatedCount} meanings!`);
      onRefresh();
    } catch (error) {
      console.error(error);
      setFillingStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFillingMeanings(false);
    }
  };

  const ttsEndpoint = settings.ttsEndpoint || (settings.baseURL ? `${settings.baseURL.replace(/\/+$/, "")}/audio/speech` : "");
  const selectedVoiceIsPreset = ttsVoiceOptions.some((option) => option.value === (settings.ttsModel || defaultTtsModel));
  const conversationVoiceAIsPreset = ttsVoiceOptions.some((option) => option.value === (settings.conversationVoiceA || defaultTtsModel));
  const conversationVoiceBIsPreset = ttsVoiceOptions.some((option) => option.value === (settings.conversationVoiceB || defaultSettings.conversationVoiceB));
  const conversationVoiceCIsPreset = ttsVoiceOptions.some((option) => option.value === (settings.conversationVoiceC || defaultSettings.conversationVoiceC));
  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section className="app-settings-panel" aria-label="Settings" onClick={(event) => event.stopPropagation()}>
        <header className="app-settings-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>LLM & Voice</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X />
          </button>
        </header>

        <form className="app-settings-form" onSubmit={(event) => event.preventDefault()}>
          <section className="app-settings-section">
            <h3>Dictionary Option Mode</h3>
            <label>
              <span>Active Option</span>
              <select
                value={settings.searchMode}
                onChange={(event) => onSettingsChange({ ...settings, searchMode: event.target.value as "default" | "idioms" })}
              >
                <option value="default">Default Option (Tra từ đơn như cũ)</option>
                <option value="idioms">Idioms Option (Lưu theo cụm từ)</option>
              </select>
            </label>
          </section>

          <section className="app-settings-section">
            <h3>LLM Endpoint</h3>
            <label>
              <span>Base URL</span>
              <input
                value={settings.baseURL}
                type="url"
                placeholder="http://localhost:20128/v1"
                onChange={(event) => onSettingsChange({ ...settings, baseURL: event.target.value })}
                autoComplete="url"
              />
            </label>
            <label>
              <span>API Key</span>
              <input
                value={settings.apiKey}
                type="password"
                placeholder="sk-..."
                onChange={(event) => onSettingsChange({ ...settings, apiKey: event.target.value })}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Model</span>
              <input
                value={settings.model}
                type="text"
                placeholder="cx/gpt-5.5"
                onChange={(event) => onSettingsChange({ ...settings, model: event.target.value })}
                autoComplete="off"
              />
            </label>
          </section>

          <section className="app-settings-section">
            <h3>Local bridge</h3>
            <p className="chat-notice" style={{ marginTop: 0 }}>
              Card creation, TTS cache, learning level, and the live library list use this URL when you run{" "}
              <code style={{ whiteSpace: "nowrap" }}>npm run voca:api</code> (or your tunnel). The web app loads cards from{" "}
              <code>/v1/cards</code> here when reachable so it matches <code>cards.json</code> on disk and the mobile app.
            </p>
            <label>
              <span>Bridge origin</span>
              <input
                value={settings.localBridgeOrigin}
                type="url"
                placeholder={`Default: ${resolvedLocalBridgeOrigin("")}`}
                onChange={(event) => onSettingsChange({ ...settings, localBridgeOrigin: event.target.value })}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Bridge API token</span>
              <input
                value={settings.bridgeApiToken}
                type="password"
                placeholder="Shared with web, mobile, and bridge"
                onChange={(event) => onSettingsChange({ ...settings, bridgeApiToken: event.target.value })}
                autoComplete="off"
              />
            </label>
          </section>

          <section className="app-settings-section">
            <div className="settings-section-title-row">
              <h3>Voice</h3>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.useApiTts !== false}
                  onChange={(event) => onSettingsChange({ ...settings, useApiTts: event.target.checked })}
                />
                <span>Use API TTS</span>
              </label>
            </div>
            <label>
              <span>Speech Endpoint</span>
              <input
                value={ttsEndpoint}
                type="url"
                placeholder="http://localhost:20128/v1/audio/speech"
                onChange={(event) => onSettingsChange({ ...settings, ttsEndpoint: event.target.value })}
                autoComplete="url"
              />
            </label>
            <label>
              <span>Voice Model</span>
              <select
                value={settings.ttsModel || defaultTtsModel}
                onChange={(event) => onSettingsChange({ ...settings, ttsModel: event.target.value })}
              >
                {!selectedVoiceIsPreset ? (
                  <option value={settings.ttsModel}>{settings.ttsModel}</option>
                ) : null}
                {ttsVoiceOptions.map((voice) => (
                  <option key={voice.value} value={voice.value}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-test-row">
              <button
                type="button"
                disabled={testingVoice}
                onClick={() => {
                  setTestingVoice(true);
                  void speakEnglish("Hello, this is a text to speech test.", settings).finally(() => setTestingVoice(false));
                }}
              >
                {testingVoice ? <Loader2 className="spin" /> : <Volume2 />}
                {testingVoice ? "Loading voice..." : "Test voice"}
              </button>
              <p>Falls back to the browser voice if API TTS is off or unavailable.</p>
            </div>
          </section>

          <section className="app-settings-section conversation-voice-settings">
            <div className="settings-section-title-row">
              <h3>Conversation Voice</h3>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.conversationAutoSelectVoices !== false}
                  onChange={(event) => onSettingsChange({ ...settings, conversationAutoSelectVoices: event.target.checked })}
                />
                <span>Auto-select voices</span>
              </label>
            </div>
            <label>
              <span>Voice A</span>
              <select
                value={settings.conversationVoiceA || defaultTtsModel}
                onChange={(event) => onSettingsChange({ ...settings, conversationVoiceA: event.target.value })}
              >
                {!conversationVoiceAIsPreset ? <option value={settings.conversationVoiceA}>{settings.conversationVoiceA}</option> : null}
                {ttsVoiceOptions.map((voice) => (
                  <option key={voice.value} value={voice.value}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Voice B</span>
              <select
                value={settings.conversationVoiceB || defaultSettings.conversationVoiceB}
                onChange={(event) => onSettingsChange({ ...settings, conversationVoiceB: event.target.value })}
              >
                {!conversationVoiceBIsPreset ? <option value={settings.conversationVoiceB}>{settings.conversationVoiceB}</option> : null}
                {ttsVoiceOptions.map((voice) => (
                  <option key={voice.value} value={voice.value}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Voice C</span>
              <select
                value={settings.conversationVoiceC || defaultSettings.conversationVoiceC}
                onChange={(event) => onSettingsChange({ ...settings, conversationVoiceC: event.target.value })}
              >
                {!conversationVoiceCIsPreset ? <option value={settings.conversationVoiceC}>{settings.conversationVoiceC}</option> : null}
                {ttsVoiceOptions.map((voice) => (
                  <option key={voice.value} value={voice.value}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-test-row conversation-voice-test-row">
              <button
                type="button"
                disabled={Boolean(testingConversationVoice)}
                onClick={() => {
                  setTestingConversationVoice("A");
                  void speakEnglish("Hi, I can start the conversation.", settings, {
                    ttsModel: settings.conversationVoiceA || defaultTtsModel,
                  }).finally(() => setTestingConversationVoice(null));
                }}
              >
                {testingConversationVoice === "A" ? <Loader2 className="spin" /> : <Volume2 />}
                Test A
              </button>
              <button
                type="button"
                disabled={Boolean(testingConversationVoice)}
                onClick={() => {
                  setTestingConversationVoice("B");
                  void speakEnglish("And I can reply with the second voice.", settings, {
                    ttsModel: settings.conversationVoiceB || defaultSettings.conversationVoiceB,
                  }).finally(() => setTestingConversationVoice(null));
                }}
              >
                {testingConversationVoice === "B" ? <Loader2 className="spin" /> : <Volume2 />}
                Test B
              </button>
              <button
                type="button"
                disabled={Boolean(testingConversationVoice)}
                onClick={() => {
                  setTestingConversationVoice("C");
                  void speakEnglish("I can be the third speaker when the conversation needs one.", settings, {
                    ttsModel: settings.conversationVoiceC || defaultSettings.conversationVoiceC,
                  }).finally(() => setTestingConversationVoice(null));
                }}
              >
                {testingConversationVoice === "C" ? <Loader2 className="spin" /> : <Volume2 />}
                Test C
              </button>
              <p>When auto-select is on, the agent receives this voice list and returns speaker-to-voice assignments.</p>
            </div>
          </section>

          <section className="app-settings-section">
            <div className="settings-section-title-row">
              <h3>Non-stop Listening</h3>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={settings.nonStopListeningEnabled}
                  onChange={(event) => onSettingsChange({ ...settings, nonStopListeningEnabled: event.target.checked })}
                />
                <span>{settings.nonStopListeningEnabled ? "On" : "Off"}</span>
              </label>
            </div>
            <p className="chat-notice" style={{ marginTop: 0 }}>
              When enabled, the Conversation player keeps generating and preloading the next listening passages in the background.
            </p>
            <label>
              <span>Preload waiting passages</span>
              <select
                value={String(settings.nonStopListeningPreloadCount || 2)}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    nonStopListeningPreloadCount: Math.max(1, Math.min(3, Number(event.target.value) || 1)),
                  })
                }
              >
                <option value="1">1 passage</option>
                <option value="2">2 passages</option>
                <option value="3">3 passages</option>
              </select>
            </label>
          </section>

          <section className="app-settings-section">
            <div className="settings-section-title-row">
              <h3>Vocabulary Data Tools</h3>
            </div>
            <p className="chat-notice" style={{ marginTop: 0 }}>
              Auto-fill missing English and Vietnamese meanings for all cards in your dictionary using AI.
            </p>
            {missingCards.length > 0 ? (
              <p className="chat-notice" style={{ marginTop: 0, color: "var(--accent)", fontWeight: 700 }}>
                Found {missingCards.length} card(s) missing meanings.
              </p>
            ) : (
              <p className="chat-notice" style={{ marginTop: 0, color: "var(--success-ink)", fontWeight: 700 }}>
                All cards are fully defined!
              </p>
            )}
            <div className="settings-test-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                disabled={fillingMeanings || missingCards.length === 0}
                onClick={handleFillMissingMeanings}
                style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}
              >
                {fillingMeanings ? <Loader2 className="spin" /> : <RefreshCw />}
                {fillingMeanings ? `Filling (${filledCount}/${totalToFill})...` : "Fill missing meanings"}
              </button>
            </div>
            {fillingStatus ? (
              <p className="chat-notice" style={{ marginTop: 8, color: "var(--accent)" }}>
                {fillingStatus}
              </p>
            ) : null}
          </section>

          <section className="app-settings-section danger-zone-section" style={{ borderTop: "1px dashed var(--danger-ink, #dc2626)", paddingTop: "16px", marginTop: "24px" }}>
            <div className="settings-section-title-row">
              <h3 style={{ color: "var(--danger-ink, #dc2626)" }}>Danger Zone</h3>
            </div>
            <p className="chat-notice" style={{ marginTop: 0 }}>
              Hành động này sẽ xóa vĩnh viễn toàn bộ từ vựng, hình ảnh và âm thanh đã lưu. Không thể khôi phục dữ liệu sau khi xóa.
            </p>
            <div className="settings-test-row" style={{ marginTop: 12 }}>
              {confirmingClearAll ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                  <label htmlFor="clear-all-confirm-input" style={{ fontSize: "13px", fontWeight: "normal", color: "var(--muted)", textTransform: "none", letterSpacing: "normal" }}>
                    Nhập <strong style={{ color: "var(--danger-ink, #dc2626)" }}>CLEAR ALL</strong> để xác nhận:
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      id="clear-all-confirm-input"
                      type="text"
                      value={clearAllInput}
                      onChange={(e) => setClearAllInput(e.target.value)}
                      placeholder="CLEAR ALL"
                      style={{ flex: 1, borderColor: "var(--danger-ink, #dc2626)" }}
                    />
                    <button
                      type="button"
                      disabled={clearAllInput !== "CLEAR ALL" || clearingAll}
                      onClick={handleClearAll}
                      style={{
                        backgroundColor: clearAllInput === "CLEAR ALL" ? "var(--danger-ink, #dc2626)" : "transparent",
                        color: clearAllInput === "CLEAR ALL" ? "#fff" : "var(--muted)",
                        borderColor: clearAllInput === "CLEAR ALL" ? "var(--danger-ink, #dc2626)" : "var(--line)",
                        padding: "8px 16px",
                        cursor: clearAllInput === "CLEAR ALL" ? "pointer" : "not-allowed",
                        fontWeight: "bold",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px"
                      }}
                    >
                      {clearingAll ? <Loader2 className="spin" /> : null}
                      Xác nhận xóa
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingClearAll(false);
                        setClearAllInput("");
                      }}
                      style={{
                        backgroundColor: "transparent",
                        border: "1px solid var(--line)",
                        padding: "8px 16px",
                        cursor: "pointer"
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClearAll(true)}
                  style={{
                    backgroundColor: "transparent",
                    color: "var(--danger-ink, #dc2626)",
                    border: "1px solid var(--danger-ink, #dc2626)",
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  Xóa tất cả từ vựng
                </button>
              )}
            </div>
          </section>
        </form>
      </section>
    </div>
  );
}

function KeyboardShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section className="app-settings-panel shortcuts-help-panel" aria-label="Keyboard Shortcuts" onClick={(event) => event.stopPropagation()}>
        <header className="app-settings-header">
          <div>
            <p className="eyebrow">Help</p>
            <h2>Keyboard Shortcuts</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close help">
            <X />
          </button>
        </header>

        <div className="shortcuts-help-content">
          <div className="shortcut-item">
            <div className="shortcut-keys">
              <kbd>/</kbd> <span className="or">or</span> <kbd>⌘</kbd><kbd>K</kbd>
            </div>
            <div className="shortcut-desc">
              <strong>Focus Search Input</strong>
              <span>Quickly focus and select all text in the search input box.</span>
            </div>
          </div>

          <div className="shortcut-item">
            <div className="shortcut-keys">
              <kbd>Esc</kbd>
            </div>
            <div className="shortcut-desc">
              <strong>Clear Search Input</strong>
              <span>Clear the search box content. Hitting Esc when focused also unfocuses (blurs) the input.</span>
            </div>
          </div>

          <div className="shortcut-item">
            <div className="shortcut-keys">
              <kbd>⌘</kbd><kbd>Enter</kbd> <span className="or">or</span> <kbd>Ctrl</kbd><kbd>Enter</kbd>
            </div>
            <div className="shortcut-desc">
              <strong>Smart Action (Search box)</strong>
              <span>If matching words exist, plays the pronunciation. If no matches exist, creates a new card.</span>
            </div>
          </div>

          <div className="shortcut-item">
            <div className="shortcut-keys">
              <kbd>Alt</kbd><kbd>V</kbd> <span className="or">or</span> <kbd>Alt</kbd><kbd>P</kbd> <span className="or">or</span> <kbd>\</kbd>
            </div>
            <div className="shortcut-desc">
              <strong>Speak Word</strong>
              <span>Text-to-speech for the selected word. If no word is selected, plays the first matching search result. Works globally (Alt+Enter also works when typing in the search box).</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function FilterBar({
  filters,
  topics,
  partsOfSpeech,
  onChange,
  onClear,
  onCommandEnter,
}: {
  filters: Filters;
  topics: string[];
  partsOfSpeech: string[];
  onChange: (filters: Filters) => void;
  onClear: () => void;
  onCommandEnter?: () => void;
}) {
  return (
    <section className="utility-bar" aria-label="Search and filters">
      <label className="search-box">
        <span>Search</span>
        <div className="input-with-icon">
          <Search />
          <input
            value={filters.query}
            type="search"
            placeholder="word, topic, tag..."
            autoComplete="off"
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onCommandEnter?.();
              }
            }}
          />
          <kbd className="search-shortcut-badge" title="Press / to search, Esc to clear"></kbd>
        </div>
      </label>
      <label>
        <span>Topic</span>
        <select value={filters.topic} onChange={(event) => onChange({ ...filters, topic: event.target.value })}>
          <option value="all">All topics</option>
          {topics.map((topic) => (
            <option key={topic} value={topic}>
              {topic}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Part of speech</span>
        <select
          value={filters.partOfSpeech}
          onChange={(event) => onChange({ ...filters, partOfSpeech: event.target.value })}
        >
          <option value="all">All types</option>
          {partsOfSpeech.map((partOfSpeech) => (
            <option key={partOfSpeech} value={partOfSpeech}>
              {partOfSpeech}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Created date</span>
        <select
          value={filters.createdDate}
          onChange={(event) => onChange({ ...filters, createdDate: event.target.value as CreatedDateFilter })}
        >
          {(["all", "today", "yesterday", "last7", "last30", "older30", "noDate"] as CreatedDateFilter[]).map(
            (createdDate) => (
              <option key={createdDate} value={createdDate}>
                {createdDateFilterLabel(createdDate)}
              </option>
            ),
          )}
        </select>
      </label>
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </section>
  );
}

function CardList({
  cards,
  selectedKey,
  selectedKeys,
  quickPreviewEnabled = false,
  settings,
  compact,
  searchQuery,
  createCardState,
  onCreateMissing,
  searchMode,
  onSelect,
}: {
  cards: Card[];
  selectedKey: string | null;
  selectedKeys?: Set<string>;
  quickPreviewEnabled?: boolean;
  settings: AiSettings;
  compact: boolean;
  searchQuery: string;
  createCardState: CreateCardState;
  onCreateMissing: (word: string) => void;
  searchMode?: "default" | "idioms";
  onSelect: (card: Card) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [gridColumns, setGridColumns] = useState(1);
  const [compactColumns, setCompactColumns] = useState(2);
  const [quickPreviewCard, setQuickPreviewCard] = useState<Card | null>(null);
  const effectiveCompact = compact && (containerWidth ? containerWidth < 900 : true);
  const columns = effectiveCompact ? compactColumns : gridColumns;
  const itemCount = Math.ceil(cards.length / columns);
  const contextPickMode = Boolean(selectedKeys);
  const showQuickPreviewButton = contextPickMode || quickPreviewEnabled;

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const updateColumns = () => {
      const width = element.clientWidth;
      setContainerWidth(width);
      if (compact && width < 900) {
        const gap = 12;
        const minCompactCardWidth = 320;
        setCompactColumns(Math.max(1, Math.min(2, Math.floor((width + gap) / (minCompactCardWidth + gap)))));
        setGridColumns(1);
      } else {
        const gap = 12;
        const minCardWidth = width < 760 ? 560 : 292;
        const nextColumns = Math.max(1, Math.min(6, Math.floor((width + gap) / (minCardWidth + gap))));
        setGridColumns(nextColumns);
        setCompactColumns(1);
      }
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  const rowVirtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (effectiveCompact ? 78 : 156),
    measureElement: (element) => element.getBoundingClientRect().height + 10,
    overscan: 10,
  });

  if (!cards.length) {
    const candidate = searchQuery.trim();
    const canCreate = Boolean(candidate);
    const isCreating = createCardState.status === "creating" && createCardState.word.toLowerCase() === candidate.toLowerCase();
    return (
      <div className="empty-list">
        <strong>No matching cards</strong>
        <span>Try a different word, topic, or part of speech.</span>
        {canCreate ? (
          searchMode === "idioms" ? (
            <button className="create-missing-card-button" type="button" onClick={() => onCreateMissing(candidate)} disabled={isCreating}>
              {isCreating ? "Creating Idioms..." : `Create Idioms for "${candidate}"`}
            </button>
          ) : (
            candidate.includes(",") ? null : (
              <button className="create-missing-card-button" type="button" onClick={() => onCreateMissing(candidate)} disabled={isCreating}>
                {isCreating ? "Creating..." : `Create "${candidate}"`}
              </button>
            )
          )
        ) : null}
        {createCardState.message ? (
          <span className={`create-card-status ${createCardState.status === "error" ? "error" : ""}`}>{createCardState.message}</span>
        ) : null}
      </div>
    );
  }

  const selectFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>, card: Card) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (showQuickPreviewButton && event.key === " ") {
      setQuickPreviewCard(card);
      return;
    }
    onSelect(card);
  };

  return (
    <div
      ref={parentRef}
      className={`card-list ${effectiveCompact ? "compact-list" : "grid-list"} ${effectiveCompact && columns >= 2 ? "compact-list-two-cols" : ""}`}
      aria-label="Vocabulary cards"
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const rowCards = cards.slice(virtualRow.index * columns, virtualRow.index * columns + columns);
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="card-grid-row"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                "--grid-columns": columns,
              } as CSSProperties}
            >
              {rowCards.map((card) => {
                const active = selectedKeys ? selectedKeys.has(cardKey(card)) : selectedKey === cardKey(card);
                return (
                  <div
                    key={cardKey(card)}
                    className={`card-row ${active ? "active" : ""} ${contextPickMode ? "context-pick-card" : ""} ${
                      showQuickPreviewButton ? "quick-preview-card" : ""
                    } level-theme-${card.level} pos-theme-${slugify(card.partOfSpeech)}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(card)}
                    onKeyDown={(event) => selectFromKeyboard(event, card)}
                  >
                    <div className="card-top-row">
                      <span className="row-main">
                        <span className="row-title-line">
                          <strong>{card.word}</strong>
                          <SpeakButton text={card.word} settings={settings} />
                        </span>
                        <span className="row-meta-line">
                          <span className="pos-badge" title={card.partOfSpeech}>{card.partOfSpeech}</span>
                          {cardPronunciation(card) ? <span className="row-ipa">{cardPronunciation(card)}</span> : null}
                        </span>
                      </span>
                      <span className={`level-badge level-${card.level}`}>
                        <span className="level-dot"></span>
                        {cardLevelLabels[card.level]}
                      </span>
                    </div>

                    {card.meaningVi ? (
                      <div className="row-meaning-container" title={card.meaningVi}>
                        {card.meaningVi}
                      </div>
                    ) : null}


                    {showQuickPreviewButton ? (
                      <button
                        className="quick-preview-button"
                        type="button"
                        aria-label={`Quick preview ${card.word}`}
                        title="Quick preview"
                        onClick={(event) => {
                          event.stopPropagation();
                          setQuickPreviewCard(card);
                        }}
                      >
                        <Eye />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {quickPreviewCard ? <QuickCardPreview card={quickPreviewCard} settings={settings} onClose={() => setQuickPreviewCard(null)} /> : null}
    </div>
  );
}

function QuickCardPreview({ card, settings, onClose }: { card: Card; settings: AiSettings; onClose: () => void }) {
  const src = imagePath(card.file);
  return (
    <div className="quick-preview-backdrop" role="presentation" onClick={onClose}>
      <section className="quick-preview-popover" aria-label={`Quick preview ${card.word}`} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p className="eyebrow">Quick Preview</p>
            <div className="quick-preview-title-line">
              <h3>{card.word}</h3>
              <SpeakButton text={card.word} settings={settings} />
            </div>
            <p>{card.partOfSpeech} · {card.topic}</p>
            {cardPronunciation(card) ? <p className="viewer-ipa">{cardPronunciation(card)}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close quick preview">
            <X />
          </button>
        </header>
        <div className="quick-preview-meta">
          <span>{card.createdAt ?? "Created date not set"}</span>
          <span className={`level-badge level-${card.level}`}>
            <span className="level-dot"></span>
            {cardLevelLabels[card.level]}
          </span>
        </div>
        <div className="quick-preview-image">
          <img src={src} alt={`${card.word} printable card`} />
        </div>
      </section>
    </div>
  );
}

function CardPreview({
  card,
  manifestSource,
  onLevelChange,
  onDeleteCard,
  settings,
  onClose,
  onOpenChat,
}: {
  card: Card;
  manifestSource: "legacy" | "versioned";
  onLevelChange: (level: CardLevel) => void;
  onDeleteCard?: (card: Card) => void;
  settings: AiSettings;
  onClose: () => void;
  onOpenChat: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const src = imagePath(card.file);
  return (
    <section className="drawer preview-drawer open" aria-label="Vocabulary preview">
      <header className="viewer-header">
        <div>
          <p className="eyebrow">Preview · {manifestSource}</p>
          <div className="viewer-title-line">
            <h2>{card.word}</h2>
            <SpeakButton text={card.word} settings={settings} />
          </div>
          <p>{card.partOfSpeech} · {card.topic}</p>
          {cardPronunciation(card) ? <p className="viewer-ipa">{cardPronunciation(card)}</p> : null}
          <div className="viewer-meta-row">
            <span className="viewer-meta-date">{card.createdAt ?? "—"}</span>
            <select
              className="level-select-compact"
              value={card.level}
              aria-label="Learning level"
              onChange={(event) => onLevelChange(event.target.value as CardLevel)}
            >
              {cardLevelOrder.map((level) => (
                <option key={level} value={level}>
                  {cardLevelLabels[level]}
                </option>
              ))}
            </select>
          </div>
          {cardDisplayTags(card).length ? (
            <div className="viewer-tags">
              {cardDisplayTags(card)
                .slice(0, 4)
                .map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
        <div className="viewer-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {confirmingDelete ? (
            <div className="delete-confirm-row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--danger-ink, #dc2626)", fontWeight: "bold" }}>Xóa từ này?</span>
              <button
                className="icon-button"
                type="button"
                style={{ height: "36px", minHeight: "36px", width: "auto", padding: "0 10px", borderColor: "var(--danger-ink, #dc2626)", color: "var(--danger-ink, #dc2626)" }}
                onClick={() => {
                  if (onDeleteCard) onDeleteCard(card);
                  setConfirmingDelete(false);
                }}
              >
                Xóa
              </button>
              <button
                className="icon-button"
                type="button"
                style={{ height: "36px", minHeight: "36px", width: "auto", padding: "0 10px" }}
                onClick={() => setConfirmingDelete(false)}
              >
                Hủy
              </button>
            </div>
          ) : (
            <>
              {onDeleteCard && (
                <button
                  className="icon-button delete-button"
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label="Delete vocabulary"
                  title="Delete vocabulary"
                  style={{ color: "var(--danger-ink, #dc2626)", borderColor: "color-mix(in srgb, var(--danger-ink, #dc2626) 30%, transparent)" }}
                >
                  <Trash2 />
                </button>
              )}
              <a className="icon-button" href={src} target="_blank" rel="noreferrer" aria-label="Open PNG" title="Open PNG">
                <ExternalLink />
              </a>
              <a className="icon-button primary" href={src} download={card.file} aria-label="Download PNG" title="Download PNG">
                <Download />
              </a>
              <button className="icon-button" type="button" onClick={onOpenChat} aria-label="Ask AI" title="Ask AI">
                <Sparkles />
              </button>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Close preview" title="Close preview">
                <X />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="image-stage">
        <img src={src} alt={`${card.word} vocabulary card`} />
      </div>
    </section>
  );
}

function QuickQuizCard({
  quiz,
  onSubmitResults,
}: {
  quiz: QuickQuiz;
  onSubmitResults?: (summary: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const isCorrect = (question: QuickQuizQuestion, value: string) => {
    const normalized = normalizeAnswer(value);
    const accepted = [question.answer, ...(question.accepted || [])].map(normalizeAnswer);
    return accepted.includes(normalized);
  };

  const correctCount = quiz.questions.filter((question, index) => isCorrect(question, answers[index] || "")).length;

  const checkAnswers = () => {
    if (checked) return;
    setChecked(true);
    quiz.questions.forEach((question, index) => {
      const userAnswer = answers[index] || "";
      recordPracticeAttempt({
        mode: "quiz",
        targetWord: question.answer,
        prompt: question.prompt,
        userAnswer,
        correctAnswer: question.answer,
        correct: isCorrect(question, userAnswer),
      });
    });
    if (submitted || !onSubmitResults) return;
    setSubmitted(true);
    const userAnswers = quiz.questions.map((_, index) => `${index + 1}. ${(answers[index] || "").trim() || "(blank)"}`);
    onSubmitResults(
      [
        "Quiz answers submitted. Briefly review only if needed.",
        `Score: ${correctCount}/${quiz.questions.length}`,
        "Answers:",
        ...userAnswers,
      ].join("\n\n"),
    );
  };

  return (
    <section className="quick-quiz-card">
      <header className="quick-quiz-header">
        <div>
          <h3>{quiz.title || "Quick quiz"}</h3>
          {quiz.instructions ? <p>{quiz.instructions}</p> : null}
        </div>
        {checked ? (
          <span className="quiz-score">
            {correctCount}/{quiz.questions.length}
          </span>
        ) : null}
      </header>

      <div className="quick-quiz-questions">
        {quiz.questions.map((question, index) => {
          const value = answers[index] || "";
          const correct = checked && isCorrect(question, value);
          const wrong = checked && value && !correct;
          return (
            <div key={`${question.prompt}-${index}`} className={`quick-quiz-question ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}>
              <label>
                <span>
                  {index + 1}. {question.prompt}
                </span>
                {question.choices?.length ? (
                  <div className="quick-quiz-choices">
                    {question.choices.map((choice) => (
                      <button
                        key={choice}
                        className={normalizeAnswer(value) === normalizeAnswer(choice) ? "selected" : ""}
                        type="button"
                        onClick={() => {
                          setAnswers((current) => ({ ...current, [index]: choice }));
                          setChecked(false);
                          setSubmitted(false);
                        }}
                      >
                        {choice}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    value={value}
                    type="text"
                    placeholder="Your answer"
                    onChange={(event) => {
                      setAnswers((current) => ({ ...current, [index]: event.target.value }));
                      setChecked(false);
                      setSubmitted(false);
                    }}
                  />
                )}
              </label>
              {checked ? (
                <p className="quiz-feedback">
                  {correct ? "Correct" : `Answer: ${question.answer}`}
                  {question.explanation ? ` · ${question.explanation}` : ""}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="quick-quiz-actions">
        <button type="button" onClick={checkAnswers}>
          Check answers
        </button>
        <button
          type="button"
          onClick={() => {
            setAnswers({});
            setChecked(false);
            setSubmitted(false);
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}

function ReadingContextCard({
  context,
  answers,
  checked,
  settings,
  onSelectAnswer,
  onCheck,
  onReset,
}: {
  context: ReadingContext;
  answers: Record<number, string>;
  checked: boolean;
  settings: AiSettings;
  onSelectAnswer: (blank: number, choice: string) => void;
  onCheck: () => void;
  onReset: () => void;
}) {
  const documents =
    context.format === "part7" && context.documents?.length
      ? context.documents
      : [{ title: context.title, documentType: context.documentType, passage: context.passage }];
  const [activeDocumentIndex, setActiveDocumentIndex] = useState(0);
  const activeDocument = documents[Math.min(activeDocumentIndex, documents.length - 1)] || documents[0];
  const answerKey = (question: ReadingQuestion, index: number) => question.blank ?? index + 1;
  const correctCount = context.questions.filter(
    (question, index) => normalizeAnswer(answers[answerKey(question, index)] || "") === normalizeAnswer(question.answer),
  ).length;

  const multiDocPart7 = context.format === "part7" && documents.length > 1;
  const activeDocumentType: ReadingDocumentType = activeDocument.documentType ?? context.documentType;
  /** Second line inside passage banner: real subject/title, not repetition of genre only */
  const passageDocSubtitleVisible =
    multiDocPart7 &&
    Boolean(activeDocument.title?.trim()) &&
    !isRedundantReadingDocumentTitle(activeDocument.title, activeDocumentType);

  useEffect(() => {
    setActiveDocumentIndex(0);
  }, [context.title, context.format, documents.length]);

  return (
    <article className="reading-card">
      <header className="reading-card-header">
        <div>
          <p className="eyebrow">TOEIC {context.format === "part6" ? "Part 6" : "Part 7"} · {context.documentType}</p>
          <h3>{context.title}</h3>
        </div>
        {checked ? (
          <span className="quiz-score">
            {correctCount}/{context.questions.length}
          </span>
        ) : null}
      </header>

      <div
        id="reading-passage-panel"
        className="reading-passage"
        role={multiDocPart7 ? "tabpanel" : undefined}
        aria-labelledby={multiDocPart7 ? `reading-doc-tab-${activeDocumentIndex}` : undefined}
      >
        {multiDocPart7 ? (
          <header className="reading-passage-doc-banner">
            <span className="reading-passage-doc-kind">{formatReadingDocumentKind(activeDocumentType)}</span>
            {passageDocSubtitleVisible ? (
              <>
                <span className="reading-passage-doc-dot" aria-hidden="true">
                  ·
                </span>
                <cite className="reading-passage-doc-title">{activeDocument.title}</cite>
              </>
            ) : null}
          </header>
        ) : null}
        {activeDocument.passage.map((line, index) => (
          <p key={`${line}-${index}`}>{formatReadingLine(line, context.format)}</p>
        ))}
      </div>

      {multiDocPart7 ? (
        <nav className="reading-document-tabs" role="tablist" aria-label="Documents in this set">
          {documents.map((_, index) => (
            <button
              key={`reading-doc-tab-btn-${index}`}
              id={`reading-doc-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={activeDocumentIndex === index}
              aria-controls="reading-passage-panel"
              aria-label={`Open document ${index + 1}: ${documents[index]?.title ?? `document ${index + 1}`}`}
              className={`reading-document-tab ${activeDocumentIndex === index ? "active" : ""}`}
              onClick={() => setActiveDocumentIndex(index)}
            >
              {index + 1}
            </button>
          ))}
        </nav>
      ) : null}

      <div className="reading-questions">
        {context.questions.map((question, questionIndex) => {
          const key = answerKey(question, questionIndex);
          const selected = answers[key] || "";
          const correct = checked && normalizeAnswer(selected) === normalizeAnswer(question.answer);
          const wrong = checked && selected && !correct;
          return (
            <section key={key} className={`reading-question ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}>
              <h4>
                {context.format === "part6" ? `[${question.blank}]` : `${questionIndex + 1}.`} {question.prompt}
              </h4>
              <div className="reading-choices">
                {question.choices.map((choice, index) => {
                  const isSelected = normalizeAnswer(selected) === normalizeAnswer(choice);
                  const isCorrectChoice = normalizeAnswer(choice) === normalizeAnswer(question.answer);
                  return (
                    <button
                      key={choice}
                      className={`${isSelected ? "selected" : ""} ${checked && isCorrectChoice ? "correct" : ""} ${
                        checked && isSelected && !isCorrectChoice ? "wrong" : ""
                      }`}
                      type="button"
                      onClick={() => onSelectAnswer(key, choice)}
                    >
                      <span className="choice-label">{drillChoiceLabels[index]}</span>
                      <span>{choice}</span>
                      <SpeakButton text={choice} label={`Play ${choice}`} settings={settings} />
                    </button>
                  );
                })}
              </div>
              {checked ? (
                <p className="reading-feedback">
                  {correct ? "Correct" : `Answer: ${question.answer}`}
                  {question.explanation ? ` · ${question.explanation}` : ""}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="reading-actions">
        <button type="button" onClick={onCheck}>
          Check answers
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </article>
  );
}

function ArticlePracticeCard({
  article,
  answers,
  checked,
  settings,
  onSelectAnswer,
  onCheck,
  onReset,
}: {
  article: ArticlePractice;
  answers: Record<number, string>;
  checked: boolean;
  settings: AiSettings;
  onSelectAnswer: (index: number, choice: string) => void;
  onCheck: () => void;
  onReset: () => void;
}) {
  const correctCount = article.questions.filter((question, index) => normalizeAnswer(answers[index] || "") === normalizeAnswer(question.answer)).length;

  return (
    <article className="reading-card article-practice-card">
      <header className="reading-card-header">
        <div>
          <p className="eyebrow">Article Practice · {article.documentType}</p>
          <h3>{article.title}</h3>
        </div>
        {checked ? (
          <span className="quiz-score">
            {correctCount}/{article.questions.length}
          </span>
        ) : null}
      </header>

      <div className="reading-passage">
        {article.passage.map((line, index) => (
          <p key={`${line}-${index}`}>{line}</p>
        ))}
      </div>

      <div className="reading-questions">
        <section className="reading-question">
          <h4>Vocabulary Notes</h4>
          <div className="quick-quiz-questions">
            {article.vocabularyNotes.map((note) => (
              <p key={note.word} className="quiz-feedback">
                <strong>{note.word}</strong> <SpeakButton text={note.word} label={`Play ${note.word}`} settings={settings} />: {note.contextMeaning} · {note.meaningVi}
              </p>
            ))}
          </div>
        </section>

        {article.questions.map((question, questionIndex) => {
          const selected = answers[questionIndex] || "";
          const correct = checked && normalizeAnswer(selected) === normalizeAnswer(question.answer);
          const wrong = checked && selected && !correct;
          return (
            <section key={`${question.prompt}-${questionIndex}`} className={`reading-question ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}>
              <h4>
                {questionIndex + 1}. {question.prompt}
              </h4>
              <div className="reading-choices">
                {question.choices.map((choice, index) => {
                  const isSelected = normalizeAnswer(selected) === normalizeAnswer(choice);
                  const isCorrectChoice = normalizeAnswer(choice) === normalizeAnswer(question.answer);
                  return (
                    <button
                      key={choice}
                      className={`${isSelected ? "selected" : ""} ${checked && isCorrectChoice ? "correct" : ""} ${
                        checked && isSelected && !isCorrectChoice ? "wrong" : ""
                      }`}
                      type="button"
                      onClick={() => onSelectAnswer(questionIndex, choice)}
                    >
                      <span className="choice-label">{drillChoiceLabels[index]}</span>
                      <span>{choice}</span>
                      <SpeakButton text={choice} label={`Play ${choice}`} settings={settings} />
                    </button>
                  );
                })}
              </div>
              {checked ? (
                <p className="reading-feedback">
                  {correct ? "Correct" : `Answer: ${question.answer}`}
                  {question.explanation ? ` · ${question.explanation}` : ""}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="reading-actions">
        <button type="button" onClick={onCheck}>
          Check answers
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </article>
  );
}

function AssistantMessageContent({
  content,
  onSubmitQuizResults,
}: {
  content: string;
  onSubmitQuizResults?: (summary: string) => void;
}) {
  const quiz = maybeParseQuickQuiz(content);
  return quiz ? <QuickQuizCard quiz={quiz} onSubmitResults={onSubmitQuizResults} /> : <MarkdownText value={content} />;
}

function isLikelyStructuredQuiz(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") && trimmed.includes('"type"') && trimmed.includes("quick_quiz");
}

function clampGlobalAgentPanelWidth(px: number): number {
  const raw = Number.isFinite(px) ? Math.round(px) : DEFAULT_GLOBAL_AGENT_PANEL_PX;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const maxAllowed = Math.min(GLOBAL_AGENT_PANEL_MAX_PX, vw - 44);
  const minAllowed = Math.min(GLOBAL_AGENT_PANEL_MIN_PX, maxAllowed);
  return Math.max(minAllowed, Math.min(maxAllowed, raw));
}

function isAppleLikeKeyboard(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return /\bMacintosh|MacIntel|Mac OS X|CPU (?:iPhone|iPad) OS\b|\biPhone\b|\biPad\b/.test(ua);
}

function GlobalAgentPanel({
  cards,
  contextScope,
  contextTopics,
  activeVocabularyIndex,
  contextDescription,
  onContextScopeChange,
  selectedWord,
  settings,
  onClose,
}: {
  cards: Card[];
  contextScope: GlobalContextScope;
  contextTopics: string[];
  activeVocabularyIndex: string[];
  contextDescription: string;
  onContextScopeChange: (next: Partial<GlobalContextScope>) => void;
  selectedWord?: string;
  settings: AiSettings;
  onClose: () => void;
}) {
  const [mode, setMode] = useStoredState<AgentMode>("voca.globalAgent.mode", "assistant");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useStoredState<ChatMessage[]>("voca.globalAgent.messages", []);
  const [sending, setSending] = useState(false);
  const [drill, setDrill] = useStoredState<ChallengeDrill | null>("voca.globalAgent.activeDrill", null);
  const [drillQueue, setDrillQueue] = useStoredState<ChallengeDrill[]>("voca.globalAgent.drillQueue", []);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [prefetchingDrills, setPrefetchingDrills] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [readingContext, setReadingContext] = useStoredState<ReadingContext | null>("voca.globalAgent.readingContext", null);
  const [readingAnswers, setReadingAnswers] = useStoredState<Record<number, string>>("voca.globalAgent.readingAnswers", {});
  const [readingChecked, setReadingChecked] = useStoredState<boolean>("voca.globalAgent.readingChecked", false);
  const [readingQueue, setReadingQueue] = useStoredState<ReadingQueue>("voca.globalAgent.readingQueue", { part6: [], part7: [] });
  const [readingError, setReadingError] = useState<string | null>(null);
  const [articlePractice, setArticlePractice] = useStoredState<ArticlePractice | null>("voca.globalAgent.articlePractice", null);
  const [articleAnswers, setArticleAnswers] = useStoredState<Record<number, string>>("voca.globalAgent.articleAnswers", {});
  const [articleChecked, setArticleChecked] = useStoredState<boolean>("voca.globalAgent.articleChecked", false);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [conversation, setConversation] = useStoredState<DailyConversation | null>("voca.globalAgent.conversation", null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [conversationFormat, setConversationFormat] = useStoredState<ConversationFormat>("voca.globalAgent.conversationFormat", "auto");
  const [activeConversationLineIds, setActiveConversationLineIds] = useState<string[]>([]);
  const [conversationPlayingAll, setConversationPlayingAll] = useState(false);
  const [conversationQueue, setConversationQueue] = useState<DailyConversation[]>([]);
  const [recentConversationSituations, setRecentConversationSituations] = useStoredState<string[]>("voca.globalAgent.recentConversationSituations", []);
  const [recentUsedVocabulary, setRecentUsedVocabulary] = useStoredState<string[]>("voca.globalAgent.recentUsedVocabulary", []);
  const conversationPlaybackRunRef = useRef(0);
  const conversationPreloadRunRef = useRef(0);
  const conversationQueueFillRef = useRef(false);
  const conversationRef = useRef<DailyConversation | null>(conversation);
  const conversationQueueRef = useRef<DailyConversation[]>(conversationQueue);
  const recentConversationSituationsRef = useRef<string[]>(recentConversationSituations);
  const recentUsedVocabularyRef = useRef<string[]>(recentUsedVocabulary);
  const [generatedSuggestions, setGeneratedSuggestions] = useState<string[] | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const readingPrefetchRef = useRef<Set<ReadingFormat>>(new Set());
  const [panelWidthPx, setPanelWidthPx] = useState<number>(() =>
    clampGlobalAgentPanelWidth(readJson<number>(GLOBAL_AGENT_PANEL_STORAGE_KEY, DEFAULT_GLOBAL_AGENT_PANEL_PX)),
  );
  const panelWidthDragRef = useRef(panelWidthPx);
  panelWidthDragRef.current = panelWidthPx;

  const configured = Boolean(settings.baseURL && settings.apiKey && settings.model);
  const contextualSelectedWord = contextScope.mode === "custom" ? selectedWord : undefined;
  const fallbackSuggestions = useMemo(
    () =>
      globalSuggestions({
        contextScope,
        contextDescription,
        selectedWord: contextualSelectedWord,
        wordCount: activeVocabularyIndex.length,
      }),
    [activeVocabularyIndex.length, contextDescription, contextScope, contextualSelectedWord],
  );
  const suggestions = generatedSuggestions?.length ? generatedSuggestions : fallbackSuggestions;
  const contextSignature = `${contextScope.mode}|${contextScope.createdDate}|${contextScope.topic}|${contextScope.level}|${contextScope.customKeys.join(",")}`;
  const lastContextSignatureRef = useRef(contextSignature);
  const currentConversationFormat = conversationFormat === "auto" ? conversation?.format || "conversation" : conversationFormat;
  const conversationPanelTitle = conversationPanelTitles[currentConversationFormat];
  conversationRef.current = conversation;
  conversationQueueRef.current = conversationQueue;
  recentConversationSituationsRef.current = recentConversationSituations;
  recentUsedVocabularyRef.current = recentUsedVocabulary;
  const vocabularyPartOfSpeech = useMemo(() => {
    const entries = cards.flatMap((card) => {
      const values = [card.word, card.slug].filter(Boolean);
      return values.map((value) => [String(value).trim().toLowerCase(), card.partOfSpeech] as const);
    });
    return Object.fromEntries(entries);
  }, [cards]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    if (lastContextSignatureRef.current === contextSignature) return;
    lastContextSignatureRef.current = contextSignature;
    setDrillQueue([]);
    setDrillError(null);
    setReadingQueue({ part6: [], part7: [] });
    setReadingError(null);
    setArticleError(null);
    setConversationError(null);
    setConversationQueue([]);
    conversationQueueRef.current = [];
    conversationPlaybackRunRef.current += 1;
    stopCurrentSpeech();
    setActiveConversationLineIds([]);
    setConversationPlayingAll(false);
    setGeneratedSuggestions(null);
  }, [
    contextSignature,
    setDrillQueue,
    setReadingQueue,
  ]);

  useEffect(() => {
    const nextMessages = messages.filter(
      (message) =>
        !(
          message.role === "assistant" &&
          ["Invalid drill response", "No valid drill returned", "Cannot generate drill"].includes(message.content)
        ),
    );
    if (nextMessages.length !== messages.length) {
      setMessages(nextMessages);
    }
  }, [messages, setMessages]);

  useEffect(() => {
    if (drill && drill.choices.length !== 4) {
      if (drill.kind === "part2_response" && drill.choices.length === 3) return;
      setDrill(null);
    }
    if (drillQueue.some((item) => (item.kind === "part2_response" ? item.choices.length !== 3 : item.choices.length !== 4))) {
      setDrillQueue(drillQueue.filter((item) => (item.kind === "part2_response" ? item.choices.length === 3 : item.choices.length === 4)));
    }
  }, [drill, drillQueue, setDrill, setDrillQueue]);

  useEffect(() => {
    if (!conversation) {
      return;
    }
    const runId = conversationPreloadRunRef.current + 1;
    conversationPreloadRunRef.current = runId;

    void (async () => {
      const introUnit = buildConversationIntroUnit(conversation);
      if (introUnit) {
        try {
          await prefetchEnglishAudioUrl(introUnit.text, settings, conversation.voiceAssignments[introUnit.speaker]);
        } catch {
          // Keep preload opportunistic; playback can still request or fall back on demand.
        }
      }
      for (const unit of buildConversationPlaybackUnits(conversation)) {
        if (conversationPreloadRunRef.current !== runId) break;
        try {
          await prefetchEnglishAudioUrl(unit.text, settings, conversation.voiceAssignments[unit.speaker]);
        } catch {
          // Keep preload opportunistic; playback can still request or fall back on demand.
        }
      }
    })();
  }, [
    conversation,
    settings.apiKey,
    settings.baseURL,
    settings.bridgeApiToken,
    settings.localBridgeOrigin,
    settings.ttsEndpoint,
    settings.useApiTts,
  ]);

  async function generateNextGlobalSuggestions(nextMessages: ChatMessage[]) {
    if (!configured) {
      setGeneratedSuggestions(null);
      return;
    }

    const requestContextSignature = contextSignature;
    try {
      const recentMessages = nextMessages
        .filter((message) => !message.pending)
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.content }));

      const response = await fetchLlm(settings, {
        model: settings.model,
        stream: false,
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content: [
              "Create 3 short follow-up prompt suggestions for the Global Voca Agent.",
              "Return only JSON in this exact shape: {\"suggestions\":[\"...\",\"...\",\"...\"]}.",
              "Suggestions must be useful next actions after the latest assistant response.",
              "Suggestions should vary the task: quiz, compare confusing words, review plan, TOEIC usage, collocations, weak spots.",
              `Active context: ${contextDescription}`,
              `Active word count: ${activeVocabularyIndex.length}`,
              contextualSelectedWord ? `Contextual selected word: ${contextualSelectedWord}` : "No contextual selected word.",
            ].join("\n"),
          },
          ...recentMessages,
        ],
      });
      if (!response.ok) throw new Error(`Suggestion request failed: ${response.status}`);
      const data = await response.json();
      if (lastContextSignatureRef.current !== requestContextSignature) return;
      const content = extractLlmResponseText(data);
      setGeneratedSuggestions(normalizeGlobalSuggestions(parseSuggestionText(content), fallbackSuggestions));
    } catch {
      if (lastContextSignatureRef.current === requestContextSignature) {
        setGeneratedSuggestions(fallbackSuggestions);
      }
    }
  }

  async function sendAssistantMessage(text = input.trim()) {
    if (!text || sending) return;
    setInput("");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "", pending: true }]);

    if (!configured) {
      setMessages([...nextMessages, { role: "assistant", content: "Add Base URL, API key, and model in settings first." }]);
      return;
    }

    setSending(true);
    try {
      const recentQuizAnswers = extractRecentQuizAnswers(messages);
      const requestVocabularyIndex = isQuizRequest(text) ? shuffleItems(activeVocabularyIndex) : activeVocabularyIndex;
      const response = await fetchLlm(settings, {
        model: settings.model,
        temperature: 0.25,
        stream: true,
        messages: [
          { role: "system", content: globalAgentPrompt(requestVocabularyIndex, contextualSelectedWord, recentQuizAnswers, contextDescription, practiceWeaknessPrompt()) },
          ...nextMessages.slice(-12),
        ],
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      if (!response.body) {
        const data = await response.json();
        const content = extractLlmResponseText(data) || "No response content.";
        const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content }];
        setMessages(finalMessages);
        void generateNextGlobalSuggestions(finalMessages);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data);
            const delta = extractLlmDeltaText(chunk);
            if (!delta) continue;
            content += delta;
            setMessages([...nextMessages, { role: "assistant", content, pending: true }]);
          } catch {
            continue;
          }
        }
      }

      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: content || "No response content." }];
      setMessages(finalMessages);
      void generateNextGlobalSuggestions(finalMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      setMessages([...nextMessages, { role: "assistant", content: message }]);
    } finally {
      setSending(false);
    }
  }

  async function fetchDrillBatch(
    count = drillBatchSize,
    onDrill?: (drill: ChallengeDrill) => void,
    options: { revise?: boolean; stream?: boolean } = {},
  ) {
    const response = await fetchLlm(settings, {
      model: settings.model,
      temperature: 0.35,
      stream: options.stream ?? false,
      messages: [{ role: "system", content: drillPrompt(activeVocabularyIndex, contextualSelectedWord, count, contextDescription, practiceWeaknessPrompt()) }],
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);

    if (options.stream && response.body) {
      return readStreamingDrills(response, onDrill);
    }

    const data = await response.json();
    const content = extractLlmResponseText(data);
    const drills = options.revise ? await parseOrReviseDrillBatch(content) : parseDrillText(content, activeVocabularyIndex);
    drills.forEach((item) => onDrill?.(item));
    return drills;
  }

  async function readStreamingDrills(response: Response, onDrill?: (drill: ChallengeDrill) => void): Promise<ChallengeDrill[]> {
    if (!response.body) return [];

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const drills: ChallengeDrill[] = [];
    const seen = new Set<string>();
    let sseBuffer = "";
    let content = "";
    let lineBuffer = "";

    const acceptDrill = (item: ChallengeDrill) => {
      const key = `${item.scenario.toLowerCase()}|${item.answer.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      drills.push(item);
      onDrill?.(item);
    };

    const processText = (text: string) => {
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim().replace(/^```(?:json)?|```$/g, "").trim();
        if (!line || !line.startsWith("{") || !line.endsWith("}")) continue;
        try {
          parseDrillText(line, activeVocabularyIndex).forEach(acceptDrill);
        } catch {
          // Keep waiting for a valid complete drill line.
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data);
          const delta = extractLlmDeltaText(chunk);
          if (!delta) continue;
          content += delta;
          processText(delta);
        } catch {
          continue;
        }
      }
    }

    if (lineBuffer.trim()) {
      try {
        parseDrillText(lineBuffer.trim(), activeVocabularyIndex).forEach(acceptDrill);
      } catch {
        // Fall back to parsing the complete content below.
      }
    }

    if (!drills.length && content.trim()) {
      parseDrillText(content, activeVocabularyIndex).forEach(acceptDrill);
    }

    return drills;
  }

  async function requestPracticeRevision(kind: "drill_ndjson" | "reading_context" | "article_practice", content: string, report: { score: number; issues: string[] }) {
    const response = await fetchLlm(settings, {
      model: settings.model,
      stream: false,
      temperature: 0.2,
      messages: [{ role: "system", content: revisePracticePrompt(kind, content, report) }],
    });
    if (!response.ok) throw new Error(`Revision failed: ${response.status}`);
    const data = await response.json();
    return extractLlmResponseText(data);
  }

  async function parseOrReviseDrillBatch(content: string): Promise<ChallengeDrill[]> {
    const drills = parseDrillText(content, activeVocabularyIndex);
    const report = assessDrillBatchQuality(drills);
    if (report.score >= 4) return drills;
    const revised = await requestPracticeRevision("drill_ndjson", content, report);
    return parseDrillText(revised, activeVocabularyIndex);
  }

  async function prefetchDrillQueue() {
    if (!configured || prefetchingDrills || !activeVocabularyIndex.length) return;
    setPrefetchingDrills(true);
    try {
      const drills = await fetchDrillBatch(drillBatchSize, undefined, { revise: true, stream: false });
      setDrillQueue((current) => [...current, ...drills].slice(0, drillBatchSize * 2));
    } catch {
      // Prefetch should stay silent; the foreground Next action reports errors.
    } finally {
      setPrefetchingDrills(false);
    }
  }

  async function generateDrill() {
    setSelectedChoice(null);
    setDrillError(null);
    if (!configured) {
      setDrill(null);
      setDrillError("Add Base URL, API key, and model in settings first.");
      return;
    }

    if (drillQueue.length) {
      const [nextDrill, ...remaining] = drillQueue;
      setDrill(nextDrill);
      setDrillError(null);
      setDrillQueue(remaining);
      if (remaining.length <= drillPrefetchThreshold) {
        void prefetchDrillQueue();
      }
      return;
    }

    setSending(true);
    try {
      let firstDrillShown = false;
      const drills = await fetchDrillBatch(drillBatchSize, (item) => {
        if (!firstDrillShown) {
          firstDrillShown = true;
          setDrill(item);
          setDrillError(null);
        }
      }, { revise: false, stream: true });
      const [nextDrill] = drills;
      if (!nextDrill) throw new Error("No valid drill returned");
      if (!firstDrillShown) {
        setDrill(nextDrill);
        setDrillError(null);
      }
      void prefetchDrillQueue();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot generate drill";
      setDrillError(message);
    } finally {
      setSending(false);
    }
  }

  async function fetchReadingContext(format: ReadingFormat): Promise<ReadingContext> {
    const response = await fetchLlm(settings, {
      model: settings.model,
      stream: false,
      temperature: 0.35,
      messages: [{ role: "system", content: readingPrompt(activeVocabularyIndex, contextualSelectedWord, format, contextDescription, practiceWeaknessPrompt()) }],
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    const content = extractLlmResponseText(data);
    const context = parseReadingContext(content);
    const report = assessReadingQuality(context);
    if (report.score >= 4) return context;
    const revised = await requestPracticeRevision("reading_context", content, report);
    return parseReadingContext(revised);
  }

  async function fetchArticlePractice(): Promise<ArticlePractice> {
    const response = await fetchLlm(settings, {
      model: settings.model,
      stream: false,
      temperature: 0.35,
      messages: [{ role: "system", content: articlePracticePrompt(activeVocabularyIndex, contextualSelectedWord, contextDescription, practiceWeaknessPrompt()) }],
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    const content = extractLlmResponseText(data);
    const article = parseArticlePractice(content);
    const report = assessArticlePracticeQuality(article);
    if (report.score >= 4) return article;
    const revised = await requestPracticeRevision("article_practice", content, report);
    return parseArticlePractice(revised);
  }

  async function fetchDailyConversation(recentSituations: string[]): Promise<DailyConversation> {
    const availableVoices = ttsVoiceOptions.map((voice) => ({ id: voice.value, label: voice.label }));

    const activeWords = [...activeVocabularyIndex];
    const history = recentUsedVocabularyRef.current || [];
    const historyMap = new Map<string, number>();
    history.forEach((word, idx) => {
      historyMap.set(String(word).trim().toLowerCase(), idx);
    });

    const unusedWords: string[] = [];
    const usedWordsInHistory: string[] = [];

    activeWords.forEach((word) => {
      const cleanWord = String(word).trim().toLowerCase();
      if (historyMap.has(cleanWord)) {
        usedWordsInHistory.push(word);
      } else {
        unusedWords.push(word);
      }
    });

    const shuffledUnused = shuffleItems(unusedWords);
    const sortedUsed = usedWordsInHistory.sort((a, b) => {
      const idxA = historyMap.get(String(a).trim().toLowerCase())!;
      const idxB = historyMap.get(String(b).trim().toLowerCase())!;
      return idxA - idxB;
    });

    const prioritizedVocabulary = [...shuffledUnused, ...sortedUsed].slice(0, 50);

    const formatInstruction =
      conversationFormat === "auto"
        ? "Format preference: Auto. Choose one suitable format at random from conversation, radio, announcement, or story based on the vocabulary context."
        : `Format preference: ${conversationFormat}. Use this exact format.`;
    const speakerInstruction =
      "Speaker selection is always automatic. Choose speakers as appropriate for the selected format and vocabulary context. conversation should use 2, 3, or 4 speakers; announcement must normally use exactly 1 speaker; story must normally use exactly 1 narrator; radio can use 1 host or 2 hosts.";
    const response = await fetchLlm(settings, {
      model: settings.model,
      stream: false,
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content: [
            "Generate one practical everyday English listening passage for vocabulary learning and listening exposure.",
            "Return only JSON in this exact shape:",
            "{\"type\":\"daily_conversation\",\"format\":\"conversation|radio|announcement|story\",\"title\":\"...\",\"context\":\"...\",\"speakers\":[\"...\"],\"voiceAssignments\":{\"Speaker\":\"voice_id\"},\"lines\":[{\"id\":\"l1\",\"speaker\":\"...\",\"text\":\"...\",\"translation\":\"...\",\"vocabulary\":[\"...\"],\"vocabularyMeanings\":{\"english term\":\"Vietnamese phrase in translation\"}}]}",
            formatInstruction,
            speakerInstruction,
            "First, infer a natural daily-life situation from the active vocabulary index. The conversation must be built around that vocabulary context.",
            "The active vocabulary index is sorted by priority (least recently used first). You MUST select target words from the top of the list first. Avoid choosing words from the end of the list.",
            "Pick 5-7 target vocabulary items from the active vocabulary index that can fit one realistic situation together.",
            "Use at least 4 target vocabulary items naturally in the conversation text. Put used target words/phrases in each line's vocabulary array.",
            "For every highlighted vocabulary item, include vocabularyMeanings mapping that item to the exact Vietnamese phrase appearing in translation when possible.",
            "Format rules: conversation covers dialogue, interview, and group chat in one format. It must be back-and-forth spoken interaction with 2, 3, or 4 people chosen by you. Radio sounds like a short radio segment. Announcement is a public notice from one speaker. Story is narrated prose from one narrator.",
            "If format is story, use exactly one speaker named Narrator. The title/context must describe a story or scene, not people talking. Do not create dialogue turns for story.",
            "If format is announcement, use exactly one speaker named Announcer.",
            "Choose a fresh situation that differs from recent situations. If recent situations were about leaks, drainage, water, cones, maintenance, or office facilities, do not choose that cluster again unless most target vocabulary requires it.",
            "For conversation, use 8-10 short natural turns. For radio with 2 hosts, group consecutive sentences naturally by host. For story or announcement, return 1-3 article-style paragraphs under the same speaker; each paragraph should contain 2-4 connected sentences, not one sentence per line.",
            "Each line text must be natural spoken English. Optional translation should be Vietnamese.",
            "Highlight 1-2 vocabulary words or phrases per line.",
            settings.conversationAutoSelectVoices !== false
              ? "Choose suitable voiceAssignments from the available voice list. Use only voice ids from the list."
              : "Voice assignments are optional because the app will map speakers to Voice A, Voice B, and Voice C.",
            `Active context: ${contextDescription}`,
            `Selected word: ${contextualSelectedWord || "none"}`,
            `Recent situations to avoid JSON: ${JSON.stringify(recentSituations.slice(0, 6))}`,
            `Random seed: ${Date.now()}-${Math.random().toString(16).slice(2)}`,
            `Active vocabulary index JSON: ${JSON.stringify(prioritizedVocabulary)}`,
            `Available voices JSON: ${JSON.stringify(availableVoices)}`,
          ].join("\n"),
        },
      ],
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    const nextConversation = normalizeDailyConversation(extractLlmResponseText(data), settings);

    const usedWords = Array.from(
      new Set(
        nextConversation.lines
          .flatMap((line) => line.vocabulary || [])
          .map((w) => String(w).trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (usedWords.length > 0) {
      setRecentUsedVocabulary((current) => {
        const next = [
          ...current.filter((w) => !usedWords.includes(String(w).trim().toLowerCase())),
          ...usedWords,
        ].slice(-500);
        recentUsedVocabularyRef.current = next;
        return next;
      });
      const bridgeOrigin = resolvedLocalBridgeOrigin(settings.localBridgeOrigin);
      fetch(`${bridgeOrigin}/v1/listen/record-used-words`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bridgeAuthorizationHeader(settings.bridgeApiToken),
        },
        body: JSON.stringify({ words: usedWords }),
      }).catch((err) => console.warn("Failed to record used words on bridge:", err));
    }

    return nextConversation;
  }

  function rememberConversationSituation(nextConversation: DailyConversation) {
    const nextSituation = nextConversation.context || nextConversation.title;
    if (!nextSituation) return;
    setRecentConversationSituations((current) => {
      const next = [nextSituation, ...current.filter((item) => item !== nextSituation)].slice(0, 8);
      recentConversationSituationsRef.current = next;
      return next;
    });
  }

  async function preloadConversationAudio(nextConversation: DailyConversation) {
    const introUnit = buildConversationIntroUnit(nextConversation);
    if (introUnit) {
      await prefetchEnglishAudioUrl(introUnit.text, settings, nextConversation.voiceAssignments[introUnit.speaker]);
    }
    for (const unit of buildConversationPlaybackUnits(nextConversation)) {
      await prefetchEnglishAudioUrl(unit.text, settings, nextConversation.voiceAssignments[unit.speaker]);
    }
  }

  async function fillNonStopConversationQueue(minimumTotal: number) {
    if (conversationQueueFillRef.current) return;
    conversationQueueFillRef.current = true;
    try {
      while ((conversationRef.current ? 1 : 0) + conversationQueueRef.current.length < minimumTotal) {
        const recentSituations = [
          ...recentConversationSituationsRef.current,
          ...(conversationRef.current ? [conversationRef.current.context || conversationRef.current.title] : []),
          ...conversationQueueRef.current.map((item) => item.context || item.title),
        ].filter(Boolean);
        const nextConversation = await fetchDailyConversation(recentSituations);
        await preloadConversationAudio(nextConversation);
        conversationQueueRef.current = [...conversationQueueRef.current, nextConversation];
        setConversationQueue(conversationQueueRef.current);
        rememberConversationSituation(nextConversation);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot preload non-stop listening.";
      setConversationError(message);
    } finally {
      conversationQueueFillRef.current = false;
    }
  }

  function targetNonStopConversationCount() {
    return Math.max(1, Math.min(3, Number(settings.nonStopListeningPreloadCount) || 1)) + 1;
  }

  async function generateConversation() {
    setConversationError(null);
    setActiveConversationLineIds([]);
    setConversationQueue([]);
    conversationQueueRef.current = [];
    conversationPlaybackRunRef.current += 1;
    stopCurrentSpeech();
    if (!configured) {
      setConversation(null);
      setConversationError("Add Base URL, API key, and model in settings first.");
      return;
    }
    if (!activeVocabularyIndex.length) {
      setConversationError("Choose at least 1 target word in the active context.");
      return;
    }

    setSending(true);
    try {
      const nextConversation = await fetchDailyConversation(recentConversationSituations);
      setConversation(nextConversation);
      conversationRef.current = nextConversation;
      rememberConversationSituation(nextConversation);
      if (settings.nonStopListeningEnabled) {
        void preloadConversationAudio(nextConversation).catch(() => undefined);
        void fillNonStopConversationQueue(targetNonStopConversationCount());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot generate conversation";
      setConversationError(message);
    } finally {
      setSending(false);
    }
  }

  async function playConversationLine(line: ConversationLine) {
    if (!conversation) return;
    const unit = buildConversationPlaybackUnits(conversation).find((item) => item.ids.includes(line.id)) || {
      ids: [line.id],
      speaker: line.speaker,
      text: line.text,
    };
    conversationPlaybackRunRef.current += 1;
    setConversationPlayingAll(false);
    setActiveConversationLineIds(unit.ids);
    try {
      await speakEnglish(unit.text, settings, {
        ttsModel: conversation.voiceAssignments[unit.speaker],
        waitForEnd: true,
      });
    } finally {
      setActiveConversationLineIds((current) => (current.some((id) => unit.ids.includes(id)) ? [] : current));
    }
  }

  async function playFullConversation() {
    if (!conversation || conversationPlayingAll) return;
    const runId = conversationPlaybackRunRef.current + 1;
    conversationPlaybackRunRef.current = runId;
    setConversationPlayingAll(true);
    try {
      if (settings.nonStopListeningEnabled) {
        await playNonStopConversations(runId, conversation);
      } else {
        for (const unit of buildConversationPlaybackUnits(conversation)) {
          if (conversationPlaybackRunRef.current !== runId) break;
          setActiveConversationLineIds(unit.ids);
          await speakEnglish(unit.text, settings, {
            ttsModel: conversation.voiceAssignments[unit.speaker],
            waitForEnd: true,
          });
        }
      }
    } finally {
      if (conversationPlaybackRunRef.current === runId) {
        setActiveConversationLineIds([]);
        setConversationPlayingAll(false);
      }
    }
  }

  async function playNonStopConversations(runId: number, firstConversation: DailyConversation) {
    let activeConversation: DailyConversation | null = firstConversation;
    void fillNonStopConversationQueue(targetNonStopConversationCount());

    while (conversationPlaybackRunRef.current === runId && activeConversation) {
      conversationRef.current = activeConversation;
      setConversation(activeConversation);
      const introUnit = buildConversationIntroUnit(activeConversation);
      if (introUnit) {
        setActiveConversationLineIds([]);
        await speakEnglish(introUnit.text, settings, {
          ttsModel: activeConversation.voiceAssignments[introUnit.speaker],
          waitForEnd: true,
        });
        if (conversationPlaybackRunRef.current !== runId) break;
        await delay(nonStopIntroGapMs);
      }

      for (const unit of buildConversationPlaybackUnits(activeConversation)) {
        if (conversationPlaybackRunRef.current !== runId) break;
        setActiveConversationLineIds(unit.ids);
        await speakEnglish(unit.text, settings, {
          ttsModel: activeConversation.voiceAssignments[unit.speaker],
          waitForEnd: true,
        });
      }
      if (conversationPlaybackRunRef.current !== runId) break;

      setActiveConversationLineIds([]);
      const [nextConversation, ...rest] = conversationQueueRef.current;
      conversationQueueRef.current = rest;
      setConversationQueue(rest);
      void fillNonStopConversationQueue(targetNonStopConversationCount());
      if (!nextConversation) {
        conversationRef.current = null;
        await fillNonStopConversationQueue(1);
      }
      const nextFromQueue = nextConversation || conversationQueueRef.current[0] || null;
      if (nextFromQueue && nextFromQueue === conversationQueueRef.current[0]) {
        conversationQueueRef.current = conversationQueueRef.current.slice(1);
        setConversationQueue(conversationQueueRef.current);
      }
      activeConversation = nextFromQueue;
      if (activeConversation) await delay(nonStopItemGapMs);
    }
  }

  function stopConversationPlayback() {
    conversationPlaybackRunRef.current += 1;
    stopCurrentSpeech();
    setActiveConversationLineIds([]);
    setConversationPlayingAll(false);
  }

  async function generateArticlePractice() {
    setArticleError(null);
    setArticleChecked(false);
    setArticleAnswers({});
    if (!configured) {
      setArticlePractice(null);
      setArticleError("Add Base URL, API key, and model in settings first.");
      return;
    }
    if (!activeVocabularyIndex.length) {
      setArticleError("Choose at least 1 target word in the active context.");
      return;
    }

    setSending(true);
    try {
      setArticlePractice(await fetchArticlePractice());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot generate article practice";
      setArticleError(message);
    } finally {
      setSending(false);
    }
  }

  async function prefetchReadingQueue(format: ReadingFormat, force = false) {
    if (
      !configured ||
      readingPrefetchRef.current.has(format) ||
      !activeVocabularyIndex.length ||
      (!force && (readingQueue[format] || []).length >= readingCacheTarget)
    ) {
      return;
    }
    readingPrefetchRef.current.add(format);
    try {
      const context = await fetchReadingContext(format);
      setReadingQueue((current) => ({
        ...current,
        [format]: [...(current[format] || []), context].slice(0, readingCacheTarget),
      }));
    } catch {
      // Reading cache is opportunistic; foreground generation reports errors.
    } finally {
      readingPrefetchRef.current.delete(format);
    }
  }

  async function generateReadingContext() {
    setReadingError(null);
    setReadingChecked(false);
    setReadingAnswers({});
    if (!configured) {
      setReadingContext(null);
      setReadingError("Add Base URL, API key, and model in settings first.");
      return;
    }
    if (!activeVocabularyIndex.length) {
      setReadingError("Choose at least 1 target word in the active context.");
      return;
    }

    const nextFormat: ReadingFormat = Math.random() < 0.5 ? "part6" : "part7";
    const cachedContexts = readingQueue[nextFormat] || [];
    if (cachedContexts.length) {
      const [nextContext, ...remaining] = cachedContexts;
      setReadingContext(nextContext);
      setReadingQueue((current) => ({ ...current, [nextFormat]: remaining }));
      if (remaining.length < readingCacheTarget) {
        void prefetchReadingQueue(nextFormat, true);
      }
      return;
    }

    setSending(true);
    try {
      setReadingContext(await fetchReadingContext(nextFormat));
      void prefetchReadingQueue(nextFormat, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot generate reading context";
      setReadingError(message);
    } finally {
      setSending(false);
    }
  }

  function checkReadingAnswers() {
    if (!readingContext || readingChecked) return;
    readingContext.questions.forEach((question, index) => {
      const key = question.blank ?? index + 1;
      recordPracticeAttempt({
        mode: "reading",
        targetWord: question.answer,
        kind: readingContext.format,
        prompt: question.prompt,
        userAnswer: readingAnswers[key] || "",
        correctAnswer: question.answer,
      });
    });
    setReadingChecked(true);
  }

  function checkArticleAnswers() {
    if (!articlePractice || articleChecked) return;
    articlePractice.questions.forEach((question, index) => {
      recordPracticeAttempt({
        mode: "article",
        targetWord: question.answer,
        kind: articlePractice.documentType,
        prompt: question.prompt,
        userAnswer: articleAnswers[index] || "",
        correctAnswer: question.answer,
      });
    });
    setArticleChecked(true);
  }

  useEffect(() => {
    if (mode !== "drills" || !configured || !activeVocabularyIndex.length) return;
    if (drillQueue.length <= drillPrefetchThreshold) {
      void prefetchDrillQueue();
    }
  }, [activeVocabularyIndex.length, configured, contextSignature, drillQueue.length, mode]);

  useEffect(() => {
    if (mode !== "reading" || !configured || !activeVocabularyIndex.length) return;
    if ((readingQueue.part6 || []).length < readingCacheTarget) {
      void prefetchReadingQueue("part6");
    }
    if ((readingQueue.part7 || []).length < readingCacheTarget) {
      void prefetchReadingQueue("part7");
    }
  }, [
    activeVocabularyIndex.length,
    configured,
    contextSignature,
    mode,
    readingQueue.part6.length,
    readingQueue.part7.length,
  ]);

  function startNewSession() {
    setInput("");
    setMessages([]);
    setDrill(null);
    setDrillQueue([]);
    setSelectedChoice(null);
    setReadingContext(null);
    setReadingAnswers({});
    setReadingChecked(false);
    setReadingError(null);
    setArticlePractice(null);
    setArticleAnswers({});
    setArticleChecked(false);
    setArticleError(null);
    setSending(false);
  }

  function onGlobalAgentResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = panelWidthDragRef.current;
    const el = event.currentTarget;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }

    const onMove = (moveEvent: PointerEvent) => {
      const dx = startX - moveEvent.clientX;
      const next = clampGlobalAgentPanelWidth(startW + dx);
      panelWidthDragRef.current = next;
      setPanelWidthPx(next);
    };

    const onUp = () => {
      writeJson(GLOBAL_AGENT_PANEL_STORAGE_KEY, panelWidthDragRef.current);
      document.body.classList.remove("resizing");
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    document.body.classList.add("resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const answerCorrect = selectedChoice && drill ? selectedChoice.toLowerCase() === drill.answer.toLowerCase() : false;

  return (
      <section
        className="global-agent-panel"
        style={{ "--ga-panel-x": `${panelWidthPx}px` } as CSSProperties}
        aria-label="Global Agent Assistant"
      >
        <div
          className="global-agent-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel width"
          onPointerDown={onGlobalAgentResizePointerDown}
        />
        <header className="global-agent-header">
          <div>
            <p className="eyebrow">Voca</p>
            <h2>Global Agent</h2>
            <p>
              {activeVocabularyIndex.length.toLocaleString()} / {cards.length.toLocaleString()} words in context
              {contextualSelectedWord ? ` · selected: ${contextualSelectedWord}` : ""}
            </p>
          </div>
          <div className="viewer-actions">
            <button
              className="icon-button"
              type="button"
              onClick={startNewSession}
              aria-label="Refresh chat session"
              title="Refresh chat session"
            >
              <RefreshCw />
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close global agent">
              <X />
            </button>
          </div>
        </header>

        <div className="agent-mode-tabs" role="tablist" aria-label="Agent mode">
          <button className={mode === "assistant" ? "active" : ""} type="button" onClick={() => setMode("assistant")}>
            Assistant
          </button>
          <button className={mode === "drills" ? "active" : ""} type="button" onClick={() => setMode("drills")}>
            Drills
          </button>
          <button className={mode === "reading" ? "active" : ""} type="button" onClick={() => setMode("reading")}>
            Reading
          </button>
          <button className={mode === "article" ? "active" : ""} type="button" onClick={() => setMode("article")}>
            Articles
          </button>
          <button className={mode === "conversation" ? "active" : ""} type="button" onClick={() => setMode("conversation")}>
            Conversation
          </button>
        </div>

        {mode !== "conversation" ? (
        <section className="context-scope-bar" aria-label="Global agent context">
          <div
            className={`context-scope-main ${contextScope.mode === "level" ? "has-inline-select" : ""} ${
              contextScope.mode === "topic" ? "has-topic-select" : ""
            } ${contextScope.mode === "created" ? "has-created-select" : ""
            }`}
          >
            <label>
              <span>Context</span>
              <select
                value={contextScope.mode}
                onChange={(event) => onContextScopeChange({ mode: event.target.value as GlobalContextMode })}
              >
                <option value="all">All words</option>
                <option value="created">Created date</option>
                <option value="topic">Topic</option>
                <option value="level">Status</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {contextScope.mode === "created" ? (
              <label className="context-created-select">
                <span className="sr-only">Created date</span>
                <select value={contextScope.createdDate} onChange={(event) => onContextScopeChange({ createdDate: event.target.value as CreatedDateScope })}>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="last30">Last 30 days</option>
                  <option value="older30">Older than 30 days</option>
                </select>
              </label>
            ) : null}
            {contextScope.mode === "level" ? (
              <label className="context-inline-select">
                <span className="sr-only">Status</span>
                <select value={contextScope.level} onChange={(event) => onContextScopeChange({ level: event.target.value as CardLevel | "all" })}>
                  <option value="all">All statuses</option>
                  {Object.entries(cardLevelLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {contextScope.mode === "topic" ? (
              <label className="context-topic-select">
                <span>Topic</span>
                <select value={contextScope.topic} onChange={(event) => onContextScopeChange({ topic: event.target.value })}>
                  <option value="all">All topics</option>
                  {contextTopics.map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="context-scope-summary">
              <span>{contextDescription}</span>
              <strong>{activeVocabularyIndex.length.toLocaleString()} words</strong>
            </div>
            {contextScope.mode === "custom" ? (
              <button className="context-clear-button" type="button" onClick={() => onContextScopeChange({ customKeys: [] })}>
                Clear
              </button>
            ) : null}
          </div>
        </section>
        ) : null}

        {mode === "assistant" ? (
          <>
            <div className="chat-messages global-chat-messages">
              {!messages.length ? (
                <div className="chat-notice global-prompt-starters">
                  <span>Prompt suggestions</span>
                  <div className="suggestion-chips global-suggestion-chips prompt-starter-chips" aria-label="Prompt suggestions">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        className="suggestion-chip"
                        type="button"
                        title={suggestion}
                        onClick={() => sendAssistantMessage(suggestion)}
                        disabled={sending}
                      >
                        {shortSuggestionLabel(suggestion)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`chat-message ${message.role} ${message.pending ? "streaming" : ""}`}>
                  <span className="message-avatar">{message.role === "user" ? "You" : "Agent"}</span>
                  <div className="message-content">
                    {message.role === "assistant" ? (
                      message.pending && !message.content ? (
                        <span className="typing-dots" aria-label="Agent is thinking">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : message.pending && isLikelyStructuredQuiz(message.content) ? (
                        <span className="structured-streaming">
                          <span className="typing-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          Generating quiz...
                        </span>
                      ) : (
                        <AssistantMessageContent content={message.content} onSubmitQuizResults={sendAssistantMessage} />
                      )
                    ) : (
                      message.content
                    )}
                  </div>
                </article>
              ))}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
            <form
              className="chat-form global-chat-form"
              onSubmit={(event) => {
                event.preventDefault();
                sendAssistantMessage();
              }}
            >
              <div className="suggestion-chips global-suggestion-chips" aria-label="Prompt suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="suggestion-chip"
                    type="button"
                    title={suggestion}
                    onClick={() => sendAssistantMessage(suggestion)}
                    disabled={sending}
                  >
                    {shortSuggestionLabel(suggestion)}
                  </button>
                ))}
              </div>
              <div className="global-chat-composer">
                <textarea
                  id="global-agent-chat-input"
                  className="global-chat-input"
                  value={input}
                  rows={2}
                  placeholder="Ask the global agent…"
                  aria-describedby="global-chat-keyboard-hint"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendAssistantMessage();
                    }
                  }}
                />
                <button className="send-button global-chat-send" type="submit" disabled={sending} aria-label="Send message">
                  <Send />
                </button>
              </div>
              <p
                className="global-chat-hint"
                id="global-chat-keyboard-hint"
                aria-label={
                  isAppleLikeKeyboard()
                    ? "Send: Return or Enter key. New line: hold Shift while pressing Return."
                    : "Send: Enter key. New line: hold Shift while pressing Enter."
                }
              >
                <span className="global-chat-hint-line">
                  <span className="kbd-hint">{isAppleLikeKeyboard() ? "Return" : "Enter"}</span>
                  {" to send · "}
                  <span className="kbd-hint kbd-shift">Shift</span>
                  <span aria-hidden="true">+</span>
                  <span className="kbd-hint">{isAppleLikeKeyboard() ? "Return" : "Enter"}</span>
                  {" new line"}
                </span>
              </p>
            </form>
          </>
        ) : mode === "drills" ? (
          <section className="drill-panel">
            <div className="drill-toolbar">
              <div>
                <h3>TOEIC Drill</h3>
                <p>Agent mixes scenarios, sentence rescue, and collocation practice from the active context.</p>
              </div>
              <button
                type="button"
                className={`agent-toolbar-cta ${drill ? "is-secondary" : "is-primary"}`}
                onClick={generateDrill}
                disabled={sending || !activeVocabularyIndex.length}
              >
                {sending ? <RefreshCw className="spin" /> : null}
                {sending ? "Generating..." : drill ? "Next drill" : "Generate drill"}
              </button>
            </div>

            {drillError ? <div className="notice error drill-error">{drillError}</div> : null}

            {drill ? (
              <div className="drill-card">
                <div className="drill-type-row">
                  <span>
                    {drill.kind === "rescue"
                      ? "Context Rescue"
                      : drill.kind === "collocation"
                        ? "Collocation Builder"
                        : drill.kind === "error_spotting"
                          ? "Error Spotting"
                          : drill.kind === "trap"
                            ? "TOEIC Trap"
                            : drill.kind === "reverse"
                              ? "Reverse Dictionary"
                              : drill.kind === "part2_response"
                                ? "Part 2 Response"
                          : "Micro-Scenario"}
                  </span>
                  {drill.title ? <strong>{drill.title}</strong> : null}
                </div>
                {drill.instruction ? <p className="drill-instruction">{drill.instruction}</p> : null}
                <p className="drill-scenario">{drill.scenario}</p>
                <div className="drill-choices">
                  {drill.choices.map((choice, index) => {
                    const chosen = selectedChoice === choice;
                    const correct = choice.toLowerCase() === drill.answer.toLowerCase();
                    return (
                      <button
                        key={choice}
                        className={`${chosen ? "selected" : ""} ${selectedChoice && correct ? "correct" : ""} ${
                          chosen && !correct ? "wrong" : ""
                        }`}
                        type="button"
                        onClick={() => {
                          setSelectedChoice(choice);
                          recordPracticeAttempt({
                            mode: "drill",
                            targetWord: drill.targetWord || drill.answer,
                            kind: drill.kind,
                            trapType: drill.trapType,
                            prompt: drill.scenario,
                            userAnswer: choice,
                            correctAnswer: drill.answer,
                          });
                        }}
                        disabled={Boolean(selectedChoice)}
                      >
                        <span className="choice-label">{drillChoiceLabels[index] || index + 1}</span>
                        <span>{choice}</span>
                        <SpeakButton text={choice} label={`Play ${choice}`} settings={settings} />
                      </button>
                    );
                  })}
                </div>
                {selectedChoice ? (
                  <div className={`drill-feedback ${answerCorrect ? "correct" : "wrong"}`}>
                    <strong>{answerCorrect ? "Correct · Đúng rồi" : `Not quite · Chưa đúng. Correct: ${drill.answer}`}</strong>
                    <p>
                      {answerCorrect
                        ? drill.explanation
                        : drill.whyWrong?.[selectedChoice] ||
                          `Correct answer: ${drill.answer}. ${drill.explanation} / Đáp án đúng là ${drill.answer}. ${drill.explanation}`}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="chat-notice">Generate a drill to practice choosing the best word for a short TOEIC scenario.</div>
            )}
          </section>
        ) : mode === "reading" ? (
          <section className="reading-panel">
            <div className="drill-toolbar">
              <div>
                <h3>Context Builder</h3>
                <p>Generate a random TOEIC Part 6 or Part 7 passage with A/B/C/D questions.</p>
              </div>
              <div className="reading-toolbar-actions">
                <button
                  type="button"
                  className={`agent-toolbar-cta ${readingContext ? "is-secondary" : "is-primary"}`}
                  onClick={generateReadingContext}
                  disabled={sending || !activeVocabularyIndex.length}
                >
                  {sending ? <RefreshCw className="spin" /> : null}
                  {sending ? "Generating..." : readingContext ? "New context" : "Generate context"}
                </button>
              </div>
            </div>

            {readingError ? <div className="notice error drill-error">{readingError}</div> : null}

            {readingContext ? (
              <ReadingContextCard
                context={readingContext}
                answers={readingAnswers}
                checked={readingChecked}
                settings={settings}
                onSelectAnswer={(blank, choice) => {
                  setReadingAnswers((current) => ({ ...current, [blank]: choice }));
                  setReadingChecked(false);
                }}
                onCheck={checkReadingAnswers}
                onReset={() => {
                  setReadingAnswers({});
                  setReadingChecked(false);
                }}
              />
            ) : (
              <div className="chat-notice">Generate a context to practice vocabulary inside a TOEIC Part 6 or Part 7 reading passage.</div>
            )}
          </section>
        ) : mode === "article" ? (
          <section className="reading-panel">
            <div className="drill-toolbar">
              <div>
                <h3>Article Practice</h3>
                <p>Generate a short business article with vocabulary notes and context questions.</p>
              </div>
              <div className="reading-toolbar-actions">
                <button
                  type="button"
                  className={`agent-toolbar-cta ${articlePractice ? "is-secondary" : "is-primary"}`}
                  onClick={generateArticlePractice}
                  disabled={sending || !activeVocabularyIndex.length}
                >
                  {sending ? <RefreshCw className="spin" /> : null}
                  {sending ? "Generating..." : articlePractice ? "New article" : "Generate article"}
                </button>
              </div>
            </div>

            {articleError ? <div className="notice error drill-error">{articleError}</div> : null}

            {articlePractice ? (
              <ArticlePracticeCard
                article={articlePractice}
                answers={articleAnswers}
                checked={articleChecked}
                settings={settings}
                onSelectAnswer={(index, choice) => {
                  setArticleAnswers((current) => ({ ...current, [index]: choice }));
                  setArticleChecked(false);
                }}
                onCheck={checkArticleAnswers}
                onReset={() => {
                  setArticleAnswers({});
                  setArticleChecked(false);
                }}
              />
            ) : (
              <div className="chat-notice">Generate an article to study vocabulary in context before doing test-style reading.</div>
            )}
          </section>
        ) : (
          <section className="reading-panel conversation-panel">
            <div className="drill-toolbar conversation-toolbar">
              <div className="conversation-toolbar-heading">
                <div
                  className={`context-scope-main conversation-context-controls ${contextScope.mode === "level" ? "has-inline-select" : ""} ${
                    contextScope.mode === "topic" ? "has-topic-select" : ""
                  } ${contextScope.mode === "created" ? "has-created-select" : ""}`}
                >
                  <label>
                    <span>Context</span>
                    <select
                      value={contextScope.mode}
                      onChange={(event) => onContextScopeChange({ mode: event.target.value as GlobalContextMode })}
                    >
                      <option value="all">All words</option>
                      <option value="created">Created date</option>
                      <option value="topic">Topic</option>
                      <option value="level">Status</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  {contextScope.mode === "created" ? (
                    <label className="context-created-select">
                      <span className="sr-only">Created date</span>
                      <select value={contextScope.createdDate} onChange={(event) => onContextScopeChange({ createdDate: event.target.value as CreatedDateScope })}>
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="last7">Last 7 days</option>
                        <option value="last30">Last 30 days</option>
                        <option value="older30">Older than 30 days</option>
                      </select>
                    </label>
                  ) : null}
                  {contextScope.mode === "level" ? (
                    <label className="context-inline-select">
                      <span className="sr-only">Status</span>
                      <select value={contextScope.level} onChange={(event) => onContextScopeChange({ level: event.target.value as CardLevel | "all" })}>
                        <option value="all">All statuses</option>
                        {Object.entries(cardLevelLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {contextScope.mode === "topic" ? (
                    <label className="context-topic-select">
                      <span>Topic</span>
                      <select value={contextScope.topic} onChange={(event) => onContextScopeChange({ topic: event.target.value })}>
                        <option value="all">All topics</option>
                        {contextTopics.map((topic) => (
                          <option key={topic} value={topic}>
                            {topic}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {contextScope.mode === "custom" ? (
                    <button className="context-clear-button" type="button" onClick={() => onContextScopeChange({ customKeys: [] })}>
                      Clear
                    </button>
                  ) : null}
                </div>
                <label className="conversation-toolbar-select">
                  <span className="sr-only">Conversation format</span>
                  <select value={conversationFormat} onChange={(event) => setConversationFormat(event.target.value as ConversationFormat)}>
                    {Object.entries(conversationFormatLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <h3>{conversationPanelTitle}</h3>
              </div>
              <div className="reading-toolbar-actions conversation-toolbar-actions">
                {conversation ? (
                  <button
                    type="button"
                    className="agent-toolbar-cta compact-action is-secondary"
                    onClick={conversationPlayingAll ? stopConversationPlayback : playFullConversation}
                    title={conversationPlayingAll ? "Stop playback" : "Play full conversation"}
                  >
                    {conversationPlayingAll ? (
                      <span className="voice-wave toolbar-voice-wave" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : null}
                    {conversationPlayingAll ? "Stop" : "Play"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`agent-toolbar-cta compact-action ${conversation ? "is-secondary" : "is-primary"}`}
                  onClick={generateConversation}
                  disabled={sending || !activeVocabularyIndex.length}
                  title={conversation ? "New conversation" : "Generate conversation"}
                >
                  {sending ? <RefreshCw className="spin" /> : null}
                  {sending ? "Gen..." : "New"}
                </button>
              </div>
            </div>

            {conversationError ? <div className="notice error drill-error">{conversationError}</div> : null}

            {conversation ? (
              <ConversationCard
                conversation={conversation}
                activeLineIds={activeConversationLineIds}
                vocabularyPartOfSpeech={vocabularyPartOfSpeech}
                onPlayLine={playConversationLine}
              />
            ) : (
              <div className="chat-notice">Generate an everyday listening passage to hear the full context or replay a section.</div>
            )}
          </section>
        )}
      </section>
  );
}

function ConversationCard({
  conversation,
  activeLineIds,
  vocabularyPartOfSpeech,
  onPlayLine,
}: {
  conversation: DailyConversation;
  activeLineIds: string[];
  vocabularyPartOfSpeech: Record<string, string>;
  onPlayLine: (line: ConversationLine) => void;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const lineRefs = useRef<Record<string, HTMLElement | null>>({});
  const displayFormat = conversation.format || "conversation";
  const conversationalFormat = displayFormat === "conversation";
  const articleFormat = displayFormat === "announcement" || displayFormat === "story";
  const formatClass = `conversation-${displayFormat}`;
  const showSpeakerChips = conversationalFormat || conversation.speakers.length > 1;
  const articleSpeaker = conversation.speakers[0] || conversation.lines[0]?.speaker || "Speaker";
  const articleVoice = ttsVoiceOptions.find((option) => option.value === conversation.voiceAssignments[articleSpeaker]);
  const articleActive = articleFormat && activeLineIds.some((id) => conversation.lines.some((line) => line.id === id));
  const conversationKey = `${conversation.title}|${conversation.context || ""}|${conversation.lines.map((line) => line.id).join(",")}`;

  useEffect(() => {
    lineRefs.current = {};
    requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    });
  }, [conversationKey]);

  useEffect(() => {
    const firstActiveLineId = activeLineIds[0];
    if (!firstActiveLineId) return;
    lineRefs.current[firstActiveLineId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }, [activeLineIds]);

  return (
    <article ref={cardRef} className={`reading-card conversation-card ${formatClass}`}>
      <header className="reading-card-header conversation-card-header">
        <div>
          <h3>{conversation.title}</h3>
          {conversation.context ? <p>{conversation.context}</p> : null}
        </div>
      </header>

      {showSpeakerChips ? (
        <div className="conversation-meta-row">
          <div className="conversation-speakers" aria-label="Conversation speaker voices">
            {conversation.speakers.map((speaker, index) => {
              const voice = ttsVoiceOptions.find((option) => option.value === conversation.voiceAssignments[speaker]);
              return (
                <span key={speaker}>
                  <strong>{speaker}</strong>
                  {voice ? ` · ${voice.label}` : ` · Voice ${String.fromCharCode(65 + (index % 3))}`}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {articleFormat ? (
        <section
          ref={(element) => {
            for (const line of conversation.lines) {
              lineRefs.current[line.id] = element;
            }
          }}
          className={`conversation-article ${displayFormat}-article ${articleActive ? "active" : ""}`}
        >
          <div className="conversation-article-meta">
            <span>{articleSpeaker}</span>
            <span>{articleVoice?.label.replace(/^([^·]+).*/, "$1").trim() || "Voice"}</span>
            {conversation.lines[0] ? (
              <button
                className="speak-button conversation-line-play"
                type="button"
                onClick={() => onPlayLine(conversation.lines[0])}
                aria-label={`Play ${displayFormat}`}
                title={`Play ${displayFormat}`}
              >
                {articleActive ? (
                  <span className="voice-wave" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <Volume2 />
                )}
              </button>
            ) : null}
          </div>
          <div className="conversation-article-body">
            {conversation.lines.map((line) => (
              <p key={line.id} className="conversation-article-paragraph">
                {renderHighlightedVocabulary(line.text, line.vocabulary, vocabularyPartOfSpeech)}
              </p>
            ))}
          </div>
          {conversation.lines.some((line) => line.translation) ? (
            <div className="conversation-article-translation">
              {conversation.lines.map((line) =>
                line.translation ? (
                  <p key={`${line.id}-translation`}>
                    {renderTranslationWithVocabularyMeanings(line.translation, line.vocabularyMeanings)}
                  </p>
                ) : null,
              )}
            </div>
          ) : null}
        </section>
      ) : (
      <div className={`conversation-lines ${conversationalFormat ? "bubble-layout" : "script-layout"} ${displayFormat}-layout`}>
        {conversation.lines.map((line) => {
          const speakerIndex = Math.max(0, conversation.speakers.indexOf(line.speaker));
          const speakerSide = conversationalFormat && speakerIndex % 2 !== 0 ? "speaker-b" : "speaker-a";
          const voice = ttsVoiceOptions.find((option) => option.value === conversation.voiceAssignments[line.speaker]);
          const active = activeLineIds.includes(line.id);
          return (
            <section
              key={line.id}
              ref={(element) => {
                lineRefs.current[line.id] = element;
              }}
              className={`conversation-line ${speakerSide} ${conversationalFormat ? "bubble-line" : "script-line"} ${displayFormat}-line ${active ? "active" : ""}`}
            >
              {conversationalFormat ? (
                <div className="conversation-avatar" aria-hidden="true">
                  {line.speaker.slice(0, 1).toUpperCase()}
                </div>
              ) : null}
              <div className="conversation-bubble">
                <div className="conversation-line-meta">
                  <span className="conversation-speaker-name">{line.speaker}</span>
                  <span className="conversation-line-voice">{voice?.label.replace(/^([^·]+).*/, "$1").trim() || "Voice"}</span>
                  <button
                    className="speak-button conversation-line-play"
                    type="button"
                    onClick={() => onPlayLine(line)}
                    aria-label={`Play ${line.speaker} line`}
                    title="Play line"
                  >
                    {active ? (
                      <span className="voice-wave" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      <Volume2 />
                    )}
                  </button>
                </div>
                <p className="conversation-line-text">{renderHighlightedVocabulary(line.text, line.vocabulary, vocabularyPartOfSpeech)}</p>
                {line.translation ? (
                  <p className="conversation-line-translation">{renderTranslationWithVocabularyMeanings(line.translation, line.vocabularyMeanings)}</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      )}
    </article>
  );
}

function ChatPanel({
  card,
  settings,
  onClose,
}: {
  card: Card;
  settings: AiSettings;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [suggestionCache, setSuggestionCache] = useStoredState<SuggestionCache>("voca.ai.suggestions", {});
  const [conversationCache, setConversationCache] = useStoredState<ConversationCache>("voca.ai.conversations", {});
  const selectedKey = cardKey(card);
  const activeKeyRef = useRef(selectedKey);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const cachedSuggestions = suggestionCache[selectedKey];
  const suggestions =
    cachedSuggestions && Date.now() - cachedSuggestions.updatedAt <= suggestionTtlMs && cachedSuggestions.suggestions.length
      ? cachedSuggestions.suggestions
      : defaultSuggestions(card);
  const configured = Boolean(settings.baseURL && settings.apiKey && settings.model);

  useEffect(() => {
    activeKeyRef.current = selectedKey;
    const cachedConversation = conversationCache[selectedKey];
    const cachedMessages =
      cachedConversation && Date.now() - cachedConversation.updatedAt <= conversationTtlMs ? cachedConversation.messages : [];
    setInput("");
    setSending(false);
    setMessages(cachedMessages);
  }, [selectedKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, selectedKey]);

  function applyMessages(key: string, nextMessages: ChatMessage[], persist = false) {
    if (activeKeyRef.current === key) {
      setMessages(nextMessages);
    }
    if (persist) {
      setConversationCache((cache) => ({
        ...cache,
        [key]: {
          updatedAt: Date.now(),
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        },
      }));
    }
  }

  function saveSuggestions(nextSuggestions: string[]) {
    setSuggestionCache((cache) => ({
      ...cache,
      [selectedKey]: {
        updatedAt: Date.now(),
        suggestions: normalizeSuggestions(nextSuggestions, card),
      },
    }));
  }

  async function generateNextSuggestions(nextMessages: ChatMessage[]) {
    if (!configured) {
      saveSuggestions(defaultSuggestions(card));
      return;
    }

    try {
      const recentMessages = nextMessages
        .filter((message) => !message.pending)
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.content }));

      const response = await fetchLlm(settings, {
        model: settings.model,
        stream: false,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "Create 3 short follow-up prompt suggestions for an English learner using this vocabulary dictionary chat.",
              "Return only JSON in this exact shape: {\"suggestions\":[\"...\",\"...\",\"...\"]}.",
              "Suggestions should help learn meaning, examples, TOEIC traps, collocations, confusing words, or quick practice.",
              `Current word or phrase: ${card.word}`,
            ].join("\n"),
          },
          ...recentMessages,
        ],
      });
      if (!response.ok) throw new Error(`Suggestion request failed: ${response.status}`);
      const data = await response.json();
      const content = extractLlmResponseText(data);
      saveSuggestions(parseSuggestionText(content));
    } catch {
      saveSuggestions(defaultSuggestions(card));
    }
  }

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    const requestKey = selectedKey;
    if (!textOverride) {
      setInput("");
    }
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    const assistantMessage: ChatMessage = { role: "assistant", content: "", pending: true };
    applyMessages(requestKey, [...nextMessages, assistantMessage]);

    if (!configured) {
      applyMessages(requestKey, [...nextMessages, { role: "assistant", content: "Add Base URL, API key, and model in settings first." }], true);
      return;
    }

    setSending(true);
    try {
      const recentQuizAnswers = extractRecentQuizAnswers(messages);
      const response = await fetchLlm(settings, {
        model: settings.model,
        temperature: 0.25,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt(card, recentQuizAnswers) },
          ...nextMessages.slice(-12),
        ],
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      if (!response.body) {
        const data = await response.json();
        const content = extractLlmResponseText(data) || "No response content.";
        const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content }];
        applyMessages(requestKey, finalMessages, true);
        generateNextSuggestions(finalMessages);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data);
            const delta = extractLlmDeltaText(chunk);
            if (!delta) continue;
            content += delta;
            applyMessages(requestKey, [...nextMessages, { role: "assistant", content, pending: true }]);
          } catch {
            continue;
          }
        }
      }

      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: content || "No response content." }];
      applyMessages(requestKey, finalMessages, true);
      generateNextSuggestions(finalMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: message }];
      applyMessages(requestKey, finalMessages, true);
      saveSuggestions(defaultSuggestions(card));
    } finally {
      if (activeKeyRef.current === requestKey) {
        setSending(false);
      }
    }
  }

  return (
    <section className="drawer agent-drawer open" aria-label="Agent Assistant">
      <header className="viewer-header">
        <div>
          <p className="eyebrow">Agent Assistant</p>
          <h2>{card.word}</h2>
          <p>Settings are stored locally in this browser.</p>
        </div>
        <div className="viewer-actions">
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close chat">
            <X />
          </button>
        </div>
      </header>

      <div className="chat-messages global-chat-messages">
        {!messages.length ? (
          <div className="chat-notice">Ask about meaning, grammar, collocations, examples, or TOEIC traps.</div>
        ) : null}
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`chat-message ${message.role} ${message.pending ? "streaming" : ""}`}>
            <span className="message-avatar">{message.role === "user" ? "You" : "Agent"}</span>
            <div className="message-content">
              {message.role === "assistant" ? (
                message.pending && !message.content ? (
                  <span className="typing-dots" aria-label="Agent is thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : message.pending && isLikelyStructuredQuiz(message.content) ? (
                  <span className="structured-streaming">
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    Generating quiz...
                  </span>
                ) : (
                  <AssistantMessageContent content={message.content} onSubmitQuizResults={(summary) => void sendMessage(summary)} />
                )
              ) : (
                message.content
              )}
            </div>
          </article>
        ))}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>

      <form
        className="chat-form global-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <div className="suggestion-chips global-suggestion-chips" aria-label="Suggested prompts">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion-chip"
              title={suggestion}
              onClick={() => setInput(suggestion)}
              disabled={sending}
            >
              {shortSuggestionLabel(suggestion)}
            </button>
          ))}
        </div>
        <div className="global-chat-composer">
          <textarea
            id="word-agent-chat-input"
            className="global-chat-input"
            value={input}
            rows={2}
            placeholder="Ask about this word…"
            aria-describedby="word-chat-keyboard-hint"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <button className="send-button global-chat-send" type="submit" disabled={sending} aria-label="Send message">
            <Send />
          </button>
        </div>
        <p
          className="global-chat-hint"
          id="word-chat-keyboard-hint"
          aria-label={
            isAppleLikeKeyboard()
              ? "Send: Return or Enter key. New line: hold Shift while pressing Return."
              : "Send: Enter key. New line: hold Shift while pressing Enter."
          }
        >
          <span className="global-chat-hint-line">
            <span className="kbd-hint">{isAppleLikeKeyboard() ? "Return" : "Enter"}</span>
            {" to send · "}
            <span className="kbd-hint kbd-shift">Shift</span>
            <span aria-hidden="true">+</span>
            <span className="kbd-hint">{isAppleLikeKeyboard() ? "Return" : "Enter"}</span>
            {" new line"}
          </span>
        </p>
      </form>
    </section>
  );
}
