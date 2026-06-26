import { loadCachedCards, type MobileCard } from "./cards";
import { type ContextScope } from "./practice";
import { llmSettingsPayload, loadApiSettings, normalizeBaseUrl } from "./settings";
import { extractLlmDeltaText } from "@voca/core/data/llm";
import { readingPrompt, speakingPrompt } from "@voca/core/practice/prompts";
import type { ReadingFormat } from "@voca/core/practice/types";

export async function streamVocaText(
  path: string,
  body: Record<string, unknown>,
  onDelta: (text: string) => void,
): Promise<string> {
  const settings = await loadApiSettings();
  const providerSettings = llmSettingsPayload(settings);
  if (!providerSettings) throw new Error("Add LLM Base URL, API key, and model in Settings first.");

  const scope = normalizeContextScope(body.contextScope);
  const snapshot = await loadCachedCards();
  const mode = modeFromPath(path);
  const cardId = cardIdFromPath(path);
  const scopedCards = cardId ? applyCardScope(snapshot?.cards || [], cardId) : applyContextScope(snapshot?.cards || [], scope);
  const chatMessages = normalizeChatMessages(body.messages, body.message);
  const requestBody = JSON.stringify({
    model: providerSettings.model,
    temperature: mode === "conversation" ? 0.45 : 0.3,
    stream: true,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt({
          mode,
          scope,
          cards: scopedCards,
          readingFormat: requestedReadingFormat(chatMessages),
          recentQuizAnswers: normalizeStringArray(body.recentQuizAnswers),
          conversationVoices: {
            autoSelect: settings.conversationAutoSelectVoices,
            voiceA: settings.conversationVoiceA,
            voiceB: settings.conversationVoiceB,
            voiceC: settings.conversationVoiceC,
          },
        }),
      },
      ...chatMessages,
    ],
  });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${providerSettings.apiKey}`,
    "Content-Type": "application/json",
  };

  return streamChatCompletions(`${normalizeBaseUrl(providerSettings.baseURL)}/chat/completions`, headers, requestBody, onDelta);
}

function streamChatCompletions(url: string, headers: Record<string, string>, body: string, onDelta: (text: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let seenLength = 0;
    let buffer = "";
    let finalText = "";
    let settled = false;

    function settle(error?: Error) {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(finalText);
    }

    function parseChunk(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) parseLine(line);
    }

    function parseLine(line: string) {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      const event = JSON.parse(data);
      const delta = extractLlmDeltaText(event);
      if (delta) {
        finalText += delta;
        onDelta(delta);
      }
      const error = event.error?.message;
      if (error) {
        throw new Error(error);
      }
    }

    xhr.open("POST", url);
    xhr.timeout = 120000;
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.onprogress = () => {
      try {
        if (xhr.status && (xhr.status < 200 || xhr.status >= 300)) return;
        const responseText = xhr.responseText || "";
        const chunk = responseText.slice(seenLength);
        seenLength = responseText.length;
        parseChunk(chunk);
      } catch (error) {
        xhr.abort();
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    };
    xhr.onload = () => {
      try {
        const responseText = xhr.responseText || "";
        const chunk = responseText.slice(seenLength);
        seenLength = responseText.length;
        if (xhr.status < 200 || xhr.status >= 300) {
          const payload = responseText ? JSON.parse(responseText) : {};
          settle(new Error(payload?.error?.message || `Stream failed (${xhr.status})`));
          return;
        }
        parseChunk(chunk);
        if (buffer.trim()) parseLine(buffer);
        settle();
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    };
    xhr.onerror = () => settle(new Error("Network request failed."));
    xhr.ontimeout = () => settle(new Error("Stream timed out."));
    xhr.send(body);
  });
}

function modeFromPath(path: string): string {
  if (path.includes("/conversation")) return "conversation";
  if (path.includes("/drills")) return "drills";
  if (path.includes("/reading")) return "reading";
  if (path.includes("/article")) return "article";
  if (path.includes("/speaking")) return "speaking";
  if (path.includes("/agent/card/")) return "card-assistant";
  return "assistant";
}

function cardIdFromPath(path: string): string {
  const match = path.match(/\/agent\/card\/([^/]+)\/chat/);
  return match ? decodeURIComponent(match[1]) : "";
}

function normalizeContextScope(value: unknown): ContextScope {
  const raw = value && typeof value === "object" ? (value as Partial<ContextScope> & Record<string, unknown>) : {};
  const type = ["all", "today", "topic", "level", "createdDate", "custom"].includes(String(raw.type)) ? String(raw.type) : "all";
  if (type === "topic") return { type, topic: String(raw.topic || "").trim() };
  if (type === "level") return { type, level: String(raw.level || "").trim() };
  if (type === "createdDate") {
    const date = String(raw.date || "").trim();
    return {
      type,
      date,
      dateFrom: String(raw.dateFrom || date || "").trim(),
      dateTo: String(raw.dateTo || date || "").trim(),
    };
  }
  if (type === "custom") {
    const cardIds = Array.isArray(raw.cardIds) ? raw.cardIds.map((id) => String(id).trim()).filter(Boolean).slice(0, 100) : [];
    return { type, cardIds };
  }
  if (type === "today") return { type };
  return { type: "all" };
}

function contextDescription(scope: ContextScope): string {
  if (scope.type === "today") return "Cards created today";
  if (scope.type === "topic") return scope.topic ? `Topic: ${scope.topic}` : "Topic context";
  if (scope.type === "level") return scope.level ? `Level: ${scope.level}` : "Level context";
  if (scope.type === "createdDate") {
    const from = scope.dateFrom || scope.date || "";
    const to = scope.dateTo || scope.date || "";
    if (from && to && from !== to) return `Cards created from ${from} to ${to}`;
    if (from || to) return `Cards created on ${from || to}`;
    return "Created-date context";
  }
  if (scope.type === "custom") return `${scope.cardIds.length} custom selected words`;
  return "All words";
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

function isCardInDateRange(card: MobileCard, dateFrom: string, dateTo: string): boolean {
  const value = String(card.createdAt || card.updatedAt || "").slice(0, 10);
  const from = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
  const to = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function applyCardScope(cards: MobileCard[], cardId: string): MobileCard[] {
  const normalized = cardId.toLowerCase();
  return cards.filter(
    (card) => card.id.toLowerCase() === normalized || card.slug.toLowerCase() === normalized || card.word.toLowerCase() === normalized,
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 24) : [];
}

function normalizeChatMessages(messages: unknown, fallbackMessage: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  const parsed = Array.isArray(messages)
    ? messages
        .map((message) => {
          const raw = message && typeof message === "object" ? (message as Record<string, unknown>) : {};
          const role = raw.role === "assistant" ? "assistant" : "user";
          const content = String(raw.content || "").trim();
          return content ? { role, content } : null;
        })
        .filter((message): message is { role: "user" | "assistant"; content: string } => Boolean(message))
        .slice(-12)
    : [];
  if (parsed.length) return parsed;
  return [{ role: "user", content: String(fallbackMessage || "").trim() || "Help me practice my vocabulary." }];
}

function requestedReadingFormat(messages: Array<{ role: "user" | "assistant"; content: string }>): ReadingFormat {
  const text = messages.map((message) => message.content).join("\n").toLowerCase();
  if (/\bpart\s*7\b|part7/.test(text)) return "part7";
  if (/\bpart\s*6\b|part6/.test(text)) return "part6";
  return "part6";
}

function buildSystemPrompt({
  mode,
  scope,
  cards,
  recentQuizAnswers,
  conversationVoices,
  readingFormat,
}: {
  mode: string;
  scope: ContextScope;
  cards: MobileCard[];
  recentQuizAnswers: string[];
  conversationVoices: { autoSelect: boolean; voiceA: string; voiceB: string; voiceC: string };
  readingFormat: ReadingFormat;
}): string {
  if (mode === "card-assistant") {
    const card = cards[0];
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
      `Current word or phrase: ${card?.word || ""}`,
      `Part of speech: ${card?.partOfSpeech || ""}`,
      `Topic: ${card?.topic || ""}`,
      `Tags: ${(card?.tags || []).join(", ")}`,
    ].join("\n");
  }

  const context = cards
    .slice(0, 100)
    .map((card) =>
      [
        `${card.word} (${card.partOfSpeech}; ${card.topic}; level=${card.level}; tags=${card.tags.join(", ")})`,
        card.meaningVi ? `Vietnamese meaning: ${card.meaningVi}` : "",
        card.meaningEn ? `Simple English: ${card.meaningEn}` : "",
        card.toeicTrap ? `TOEIC trap: ${card.toeicTrap}` : "",
      ].filter(Boolean).join(" | "),
    )
    .join("\n");
  const targetVocabularyIndex = cards.slice(0, 100).map((card) => card.word).filter(Boolean);
  const selectedWord = cards.length === 1 ? cards[0]?.word : undefined;
  const base = [
    mode === "card-assistant"
      ? "You are an Agent Assistant for a single vocabulary card in a TOEIC vocabulary app."
      : "You are the Global Agent for a TOEIC vocabulary app.",
    "Use the provided vocabulary context. Keep output useful on mobile.",
    "Keep normal answers short and scan-friendly unless the user asks for detail.",
    "Answer in simple English with Vietnamese support when useful.",
    "When creating a quick quiz, mini quiz, missing-word quiz, fill-in quiz, test, or short answer quiz, return JSON only using this exact shape: {\"type\":\"quick_quiz\",\"title\":\"...\",\"instructions\":\"...\",\"questions\":[{\"prompt\":\"...\",\"answer\":\"...\",\"accepted\":[\"...\"],\"choices\":[\"...\"]}]}",
    "For quick_quiz, create 1-3 questions only. Prefer 1-2 questions by default.",
    "For quick_quiz choices, choices are optional. If included, include the answer and vary the answer position.",
    "For quiz requests, do not reveal answers in markdown or explanations outside the JSON. The app will hide answers until the learner checks them.",
    `Mode: ${mode}`,
    `Context scope: ${scope.type}`,
    "Vocabulary context:",
    context || "(empty)",
  ];
  if (mode === "conversation") {
    base.push(
      "Generate a practical everyday English listening conversation or short scene.",
      "Use at least 4 target vocabulary items naturally.",
      "Include Vietnamese support where useful.",
      `Conversation voice auto-select: ${conversationVoices.autoSelect ? "on" : "off"}.`,
      `Available voices: A=${conversationVoices.voiceA}, B=${conversationVoices.voiceB}, C=${conversationVoices.voiceC}.`,
    );
  }
  if (mode === "drills") {
    base.push(
      "You are creating 5 TOEIC vocabulary drills for the mobile app.",
      "Return NDJSON only. Each line must be exactly one compact JSON object for one drill. Do not wrap lines in an array. Do not use markdown or commentary.",
      "Each drill object must include these keys: kind, trapType, targetWord, testedSkill, difficulty, title, instruction, scenario, choices, answer, explanation, whyWrong.",
      "kind must be one of: scenario, rescue, collocation, error_spotting, trap, reverse, part2_response.",
      "trapType must be one of: same_word_family, wrong_preposition, near_synonym_wrong_context, similar_spelling, similar_sound, grammar_mismatch, collocation_mismatch, too_literal, wrong_question_type.",
      "difficulty must be easy, medium, or hard.",
      "For normal drills, choices must contain exactly 4 strings. For part2_response, choices must contain exactly 3 strings.",
      "The answer must exactly match one string in choices.",
      "scenario must be at least 24 characters and should be a TOEIC/workplace situation, not a dictionary definition.",
      "explanation must be at least 60 characters and teach the trap in English with Vietnamese support.",
      "whyWrong must be an object mapping wrong choice text to a short reason in English with Vietnamese support.",
      "Mix drill kinds when returning multiple lines. Use different target answers when possible.",
      "Example NDJSON line shape: {\"kind\":\"scenario\",\"trapType\":\"collocation_mismatch\",\"targetWord\":\"submit\",\"testedSkill\":\"business collocation\",\"difficulty\":\"medium\",\"title\":\"Report deadline\",\"instruction\":\"Choose the best word.\",\"scenario\":\"The manager asked employees to _____ their expense reports before Friday.\",\"choices\":[\"submit\",\"admit\",\"permit\",\"omit\"],\"answer\":\"submit\",\"explanation\":\"Submit means to formally send a document for review. In Vietnamese: nộp/gửi tài liệu đúng hạn.\",\"whyWrong\":{\"admit\":\"Admit means confess or allow entry, not send a report. / Không phù hợp với báo cáo.\",\"permit\":\"Permit means allow. / Không phải hành động nộp báo cáo.\",\"omit\":\"Omit means leave out. / Nghĩa ngược với nộp.\"}}",
    );
  }
  if (mode === "reading") {
    return readingPrompt(
      targetVocabularyIndex,
      selectedWord,
      readingFormat,
      contextDescription(scope),
      "No recorded practice mistakes yet.",
    );
  }
  if (mode === "speaking") {
    return speakingPrompt(
      targetVocabularyIndex,
      selectedWord,
      contextDescription(scope),
      "No recorded practice mistakes yet.",
    );
  }
  if (mode === "article") {
    base.push(
      "Generate exactly one article practice set.",
      "Return JSON only. Do not use markdown or commentary.",
      "Use this exact shape: {\"type\":\"article_practice\",\"title\":\"...\",\"documentType\":\"article|email|notice|memo\",\"passage\":[\"...\"],\"targetWords\":[\"...\"],\"questions\":[{\"prompt\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\"],\"answer\":\"...\",\"explanation\":\"...\"}],\"vocabularyNotes\":[{\"word\":\"...\",\"meaningVi\":\"...\",\"contextMeaning\":\"...\"}]}",
      "Passage must have 8-12 short lines.",
      "Create 3-5 questions. Each question must have exactly 4 choices, and answer must exactly match one choice.",
      "Add 3-6 vocabularyNotes with Vietnamese meaning and context meaning.",
      "Explanations must teach the reason in English with Vietnamese support and be at least 20 characters.",
    );
  }
  return base.join("\n");
}
