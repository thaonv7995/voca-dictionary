import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadCachedCards, type MobileCard } from "./cards";
import { type ContextScope } from "./practice";
import { llmSettingsPayload, loadApiSettings, ttsVoiceOptions, type ApiSettings } from "./settings";
import { extractLlmResponseText } from "@voca/core/data/llm";

export type ConversationFormat = "conversation" | "radio" | "announcement" | "story";

export type ConversationLine = {
  id: string;
  speaker: string;
  text: string;
  translation?: string;
  vocabulary: string[];
  vocabularyMeanings?: Record<string, string>;
};

export type DailyConversation = {
  type: "daily_conversation";
  format?: ConversationFormat;
  title: string;
  context?: string;
  speakers: string[];
  voiceAssignments: Record<string, string>;
  lines: ConversationLine[];
};

export type ConversationPlaybackUnit = {
  ids: string[];
  speaker: string;
  text: string;
};

export type ConversationFormatOption = "auto" | ConversationFormat;

export async function generateDailyConversation({
  format = "auto",
  contextScope = { type: "all" },
  recentSituations = [],
  recentVocabulary = [],
}: {
  format?: ConversationFormatOption;
  contextScope?: ContextScope;
  recentSituations?: string[];
  recentVocabulary?: string[];
} = {}): Promise<DailyConversation> {
  const [settings, snapshot] = await Promise.all([loadApiSettings(), loadCachedCards()]);
  const providerSettings = llmSettingsPayload(settings);
  if (!providerSettings) throw new Error("Add LLM Base URL, API key, and model in Settings first.");
  const cards = applyContextScope(snapshot?.cards || [], contextScope);
  if (!cards.length) throw new Error("Sync cards before generating a conversation.");

  // 1. Load history from AsyncStorage
  const recentUsedRaw = await AsyncStorage.getItem("voca.listen.recentUsedVocabulary");
  let recentUsedHistory: string[] = [];
  if (recentUsedRaw) {
    try {
      recentUsedHistory = JSON.parse(recentUsedRaw);
      if (!Array.isArray(recentUsedHistory)) recentUsedHistory = [];
    } catch {
      recentUsedHistory = [];
    }
  }

  // 2. Sort and prioritize cards based on history
  const historyMap = new Map<string, number>();
  recentUsedHistory.forEach((word, idx) => {
    historyMap.set(String(word).trim().toLowerCase(), idx);
  });

  const unusedCards: MobileCard[] = [];
  const usedCards: MobileCard[] = [];

  cards.forEach((card) => {
    const cleanWord = String(card.word).trim().toLowerCase();
    if (historyMap.has(cleanWord)) {
      usedCards.push(card);
    } else {
      unusedCards.push(card);
    }
  });

  const shuffledUnused = shuffle(unusedCards);
  const sortedUsed = usedCards.sort((a, b) => {
    const idxA = historyMap.get(String(a.word).trim().toLowerCase())!;
    const idxB = historyMap.get(String(b.word).trim().toLowerCase())!;
    return idxA - idxB;
  });

  const prioritizedCards = [...shuffledUnused, ...sortedUsed].slice(0, 50);

  // 3. Request
  const response = await fetch(`${providerSettings.baseURL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerSettings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: providerSettings.model,
      stream: false,
      temperature: 0.45,
      messages: [{ role: "system", content: conversationPrompt(prioritizedCards, settings, format, contextScope, recentSituations, recentVocabulary) }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Conversation request failed (${response.status})`);
  const content = extractLlmResponseText(payload);
  const nextConversation = normalizeDailyConversation(content, settings);

  // 4. Update history
  const usedWords = Array.from(
    new Set(
      nextConversation.lines
        .flatMap((line) => line.vocabulary || [])
        .map((w) => String(w).trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (usedWords.length > 0) {
    const nextHistory = [
      ...recentUsedHistory.filter((w) => !usedWords.includes(String(w).trim().toLowerCase())),
      ...usedWords,
    ].slice(-500);
    await AsyncStorage.setItem("voca.listen.recentUsedVocabulary", JSON.stringify(nextHistory)).catch(() => undefined);

    const baseUrl = settings.baseUrl.trim().replace(/\/+$/, "");
    if (baseUrl) {
      fetch(`${baseUrl}/v1/listen/record-used-words`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.token}`,
        },
        body: JSON.stringify({ words: usedWords }),
      }).catch((err) => console.warn("Failed to record used words on bridge:", err));
    }
  }

  return nextConversation;
}

export function buildConversationPlaybackUnits(conversation: DailyConversation): ConversationPlaybackUnit[] {
  const format = conversation.format || "conversation";
  const lines = conversation.lines.filter((line) => line.text.trim());
  if (!lines.length) return [];

  if (format === "story" || format === "announcement" || (format === "radio" && conversation.speakers.length <= 1)) {
    return [{ ids: lines.map((line) => line.id), speaker: lines[0].speaker, text: conversationUnitText(lines) }];
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

export function buildConversationPreloadUnits(conversation: DailyConversation): ConversationPlaybackUnit[] {
  const units = [...buildConversationPlaybackUnits(conversation)];
  for (const line of conversation.lines) {
    const text = line.text.trim();
    if (text) units.push({ ids: [line.id], speaker: line.speaker, text });
  }

  const seen = new Set<string>();
  return units.filter((unit) => {
    const voice = conversation.voiceAssignments[unit.speaker] || "";
    const key = `${voice}\n${unit.text.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function voiceLabel(voiceId: string): string {
  const voice = ttsVoiceOptions.find((option) => option.value === voiceId);
  return voice?.label.replace(/^([^·]+).*/, "$1").trim() || "Voice";
}

function conversationPrompt(
  cards: MobileCard[],
  settings: ApiSettings,
  format: ConversationFormatOption,
  contextScope: ContextScope,
  recentSituations: string[],
  recentVocabulary: string[],
): string {
  const vocabulary = cards.map((card) => ({
    word: card.word,
    partOfSpeech: card.partOfSpeech,
    topic: card.topic,
    level: card.level,
    tags: card.tags,
  }));
  const availableVoices = ttsVoiceOptions.map((voice) => ({ id: voice.value, label: voice.label }));
  return [
    "Generate one practical everyday English listening passage for vocabulary learning and listening exposure.",
    "Return only JSON in this exact shape:",
    "{\"type\":\"daily_conversation\",\"format\":\"conversation|radio|announcement|story\",\"title\":\"...\",\"context\":\"...\",\"speakers\":[\"...\"],\"voiceAssignments\":{\"Speaker\":\"voice_id\"},\"lines\":[{\"id\":\"l1\",\"speaker\":\"...\",\"text\":\"...\",\"translation\":\"...\",\"vocabulary\":[\"...\"],\"vocabularyMeanings\":{\"english term\":\"Vietnamese phrase in translation\"}}]}",
    format === "auto"
      ? "Format preference: Auto. Choose one suitable format at random from conversation, radio, announcement, or story based on the vocabulary context."
      : `Format preference: ${format}. Use this exact format.`,
    "Speaker selection is automatic. conversation should use 2, 3, or 4 speakers; announcement normally uses exactly 1 speaker; story uses exactly 1 narrator; radio can use 1 host or 2 hosts.",
    "First, infer a natural daily-life situation from the active vocabulary index. The conversation must be built around that vocabulary context.",
    "The active vocabulary index is sorted by priority (least recently used first). You MUST select target words from the top of the list first. Avoid choosing words from the end of the list.",
    "Pick 5-7 target vocabulary items from the active vocabulary index that can fit one realistic situation together.",
    "Use at least 4 target vocabulary items naturally in the English text.",
    "Each line text must be natural spoken English. Optional translation should be Vietnamese.",
    "Highlight 1-2 useful vocabulary words or phrases per line.",
    `Active context: ${describeContextScope(contextScope)}`,
    `Recent situations to avoid JSON: ${JSON.stringify(recentSituations.slice(0, 6))}`,
    `Recent vocabulary to avoid when possible JSON: ${JSON.stringify(uniqueRecentVocabulary(recentVocabulary).slice(0, 80))}`,
    "Prefer vocabulary not used in recent listening items unless the active context is too small.",
    "For every highlighted vocabulary item, include vocabularyMeanings mapping that item to the exact Vietnamese phrase appearing in translation when possible.",
    settings.conversationAutoSelectVoices
      ? "Choose suitable voiceAssignments from the available voice list. Use only voice ids from the list."
      : "Voice assignments are optional because the app will map speakers to Voice A, Voice B, and Voice C.",
    `Active vocabulary index JSON: ${JSON.stringify(vocabulary)}`,
    `Available voices JSON: ${JSON.stringify(availableVoices)}`,
    `Random seed: ${Date.now()}-${Math.random().toString(16).slice(2)}`,
  ].join("\n");
}

function uniqueRecentVocabulary(words: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const word of words) {
    const clean = String(word || "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function normalizeDailyConversation(value: string, settings: ApiSettings): DailyConversation {
  const parsed = parseJsonPayload<Partial<DailyConversation>>(value);
  const rawFormat = String(parsed.format || "").trim().toLowerCase();
  const format = ["dialogue", "group_chat", "interview"].includes(rawFormat)
    ? "conversation"
    : ["conversation", "radio", "announcement", "story"].includes(rawFormat)
      ? (rawFormat as ConversationFormat)
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
  return {
    type: "daily_conversation",
    format,
    title: String(parsed.title || "Daily conversation").trim(),
    context: parsed.context ? String(parsed.context).trim() : undefined,
    speakers,
    voiceAssignments: normalizeConversationVoiceAssignments(speakers, parsed.voiceAssignments, settings),
    lines,
  };
}

function normalizeConversationVoiceAssignments(
  speakers: string[],
  assignments: Record<string, string> | undefined,
  settings: ApiSettings,
): Record<string, string> {
  const availableVoiceIds = new Set(ttsVoiceOptions.map((voice) => voice.value));
  const fallbackVoices = [settings.conversationVoiceA, settings.conversationVoiceB, settings.conversationVoiceC];
  return Object.fromEntries(
    speakers.map((speaker, index) => {
      const assigned = settings.conversationAutoSelectVoices ? assignments?.[speaker] : undefined;
      const usableAssigned = assigned && availableVoiceIds.has(assigned) ? assigned : undefined;
      return [speaker, usableAssigned || fallbackVoices[index % fallbackVoices.length]];
    }),
  );
}

function parseJsonPayload<T>(value: string): T {
  const trimmed = value.trim().replace(/^```(?:json)?|```$/g, "").trim();
  try {
    // Strip trailing commas before closing brackets/braces to prevent JSON.parse errors
    const cleaned = trimmed.replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(cleaned) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const cleanedSlice = trimmed.slice(start, end + 1).replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(cleanedSlice) as T;
      } catch (innerErr) {
        throw new Error(`JSON slice parsing failed: ${(innerErr as Error).message}. Raw content: ${trimmed.slice(0, 300)}`);
      }
    }
    throw new Error(`Response was not JSON. Raw content: ${trimmed.slice(0, 300)}`);
  }
}

function conversationUnitText(lines: ConversationLine[]): string {
  return lines.map((line) => line.text.trim()).filter(Boolean).join("\n\n");
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function applyContextScope(cards: MobileCard[], scope: ContextScope): MobileCard[] {
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
  if (scope.type === "createdDate") {
    return cards.filter((card) => isCardInDateRange(card, scope.dateFrom || scope.date || "", scope.dateTo || scope.date || ""));
  }
  if (scope.type === "custom" && scope.cardIds.length) {
    const ids = new Set(scope.cardIds.map((id) => id.toLowerCase()));
    return cards.filter(
      (card) => ids.has(card.id.toLowerCase()) || ids.has(card.slug.toLowerCase()) || ids.has(card.word.toLowerCase()),
    );
  }
  return cards;
}

function describeContextScope(scope: ContextScope): string {
  if (scope.type === "topic") return `topic=${scope.topic || "all"}`;
  if (scope.type === "level") return `level=${scope.level || "all"}`;
  if (scope.type === "createdDate") return `date=${scope.dateFrom || scope.date || "unset"}..${scope.dateTo || scope.date || "unset"}`;
  if (scope.type === "custom") return `custom cards=${scope.cardIds.length}`;
  return scope.type;
}

function isCardInDateRange(card: MobileCard, dateFrom: string, dateTo: string): boolean {
  const value = String(card.createdAt || card.updatedAt || "").slice(0, 10);
  const from = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
  const to = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}
