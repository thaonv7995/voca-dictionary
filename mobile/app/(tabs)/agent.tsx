import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, UIManager, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { maybeParseQuickQuiz, parseArticlePractice, parseDrillText, parseReadingContext, parseSpeakingPractice } from "@voca/core/practice/parsers";
import type { ArticlePractice, ChallengeDrill, ReadingContext, ReadingDocumentType, ReadingFormat, ReadingQuestion, SpeakingPractice } from "@voca/core/practice/types";
import { normalizeAnswer } from "@voca/core/practice/utils";
import { TextAudioButton, ensureTextAudio } from "../../src/audio";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { loadCachedCards, loadCustomAgentCardIds, saveCustomAgentCardIds, type MobileCard } from "../../src/cards";
import { type ContextScope } from "../../src/practice";
import { llmSettingsPayload, loadApiSettings, normalizeBaseUrl } from "../../src/settings";
import { streamVocaText } from "../../src/streaming";
import { buildContextScope } from "../../src/streaming-ui";
import { colors, spacing } from "../../src/theme";
import { CompactContextSelector, applyContextScope, describeContext } from "../../src/compact-context-selector";
import { extractLlmResponseText } from "@voca/core/data/llm";

type ScopeType = ContextScope["type"];
type ChatMessage = { role: "user" | "assistant"; content: string; pending?: boolean };
type AgentMode = "assistant" | "drills" | "reading" | "article" | "speaking";

const cacheKeyPrefix = "voca.mobile.globalAgent.messages.";
const suggestionKeyPrefix = "voca.mobile.globalAgent.suggestions.";
const defaultPrompt = "Quiz me on weak words from my current vocabulary set.";
if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function animateNextLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

const agentModes = [
  { value: "assistant", title: "Assistant" },
  { value: "drills", title: "Drills" },
  { value: "reading", title: "Reading" },
  { value: "article", title: "Articles" },
  { value: "speaking", title: "Speaking" },
] as const;

export default function AgentScreen() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(defaultSuggestions("All vocabulary", 0));
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [activeMode, setActiveMode] = useState<AgentMode>("assistant");
  const [drill, setDrill] = useState<ChallengeDrill | null>(null);
  const [drillQueue, setDrillQueue] = useState<ChallengeDrill[]>([]);
  const [drillHistory, setDrillHistory] = useState<ChallengeDrill[]>([]);
  const [selectedDrillChoice, setSelectedDrillChoice] = useState("");
  const [drillError, setDrillError] = useState("");
  const [drillStreaming, setDrillStreaming] = useState(false);
  const [drillPrefetching, setDrillPrefetching] = useState(false);
  const [drillPendingNext, setDrillPendingNext] = useState(false);
  const [readingContext, setReadingContext] = useState<ReadingContext | null>(null);
  const [readingQueue, setReadingQueue] = useState<ReadingContext[]>([]);
  const [readingHistory, setReadingHistory] = useState<ReadingContext[]>([]);
  const [readingAnswers, setReadingAnswers] = useState<Record<number, string>>({});
  const [readingChecked, setReadingChecked] = useState(false);
  const [readingError, setReadingError] = useState("");
  const [readingStreaming, setReadingStreaming] = useState(false);
  const [readingPrefetching, setReadingPrefetching] = useState(false);
  const [readingPendingNext, setReadingPendingNext] = useState(false);
  const [articlePractice, setArticlePractice] = useState<ArticlePractice | null>(null);
  const [articleQueue, setArticleQueue] = useState<ArticlePractice[]>([]);
  const [articleHistory, setArticleHistory] = useState<ArticlePractice[]>([]);
  const [articleAnswers, setArticleAnswers] = useState<Record<number, string>>({});
  const [articleChecked, setArticleChecked] = useState(false);
  const [articleError, setArticleError] = useState("");
  const [articleStreaming, setArticleStreaming] = useState(false);
  const [articlePrefetching, setArticlePrefetching] = useState(false);
  const [articlePendingNext, setArticlePendingNext] = useState(false);
  const [speakingPractice, setSpeakingPractice] = useState<SpeakingPractice | null>(null);
  const [speakingQueue, setSpeakingQueue] = useState<SpeakingPractice[]>([]);
  const [speakingHistory, setSpeakingHistory] = useState<SpeakingPractice[]>([]);
  const [speakingError, setSpeakingError] = useState("");
  const [speakingStreaming, setSpeakingStreaming] = useState(false);
  const [speakingPrefetching, setSpeakingPrefetching] = useState(false);
  const [speakingPendingNext, setSpeakingPendingNext] = useState(false);
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("new");
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [topics, setTopics] = useState<string[]>([]);
  const [cards, setCards] = useState<MobileCard[]>([]);
  const [customCardIds, setCustomCardIds] = useState<string[]>([]);

  const contextScope = useMemo(() => buildContextScope(scopeType, { topic, level, dateFrom, dateTo, cardIds: customCardIds }), [scopeType, topic, level, dateFrom, dateTo, customCardIds]);
  const contextCards = useMemo(() => applyContextScope(cards, contextScope), [cards, contextScope]);
  const vocabularyIndex = useMemo(() => contextCards.map((card) => card.word).filter(Boolean), [contextCards]);
  const contextDescription = useMemo(() => describeContext(contextScope, contextCards.length), [contextScope, contextCards.length]);
  const contextSignature = useMemo(() => JSON.stringify(contextScope), [contextScope]);
  const cacheKey = `${cacheKeyPrefix}${contextSignature}`;
  const suggestionKey = `${suggestionKeyPrefix}${contextSignature}`;

  useEffect(() => {
    Promise.all([loadCachedCards(), loadCustomAgentCardIds()])
      .then(([snapshot, ids]) => {
        const nextCards = snapshot?.cards || [];
        const nextTopics = Array.from(new Set(nextCards.map((card) => card.topic).filter(Boolean))).sort();
        setCards(nextCards);
        setTopics(nextTopics.slice(0, 24));
        setTopic((current) => current || nextTopics[0] || "");
        setCustomCardIds(ids);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    AsyncStorage.multiGet([cacheKey, suggestionKey])
      .then((entries) => {
        if (!active) return;
        const rawMessages = entries[0]?.[1];
        const rawSuggestions = entries[1]?.[1];
        setMessages(parseCachedMessages(rawMessages));
        setSuggestions(parseCachedSuggestions(rawSuggestions, contextDescription, contextCards.length));
        setError("");
      })
      .catch(() => {
        if (active) {
          setMessages([]);
          setSuggestions(defaultSuggestions(contextDescription, contextCards.length));
        }
      });
    return () => {
      active = false;
    };
  }, [cacheKey, suggestionKey, contextDescription, contextCards.length]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages]);

  useEffect(() => {
    if (!drillPendingNext || !drillQueue.length) return;
    const [next, ...rest] = drillQueue;
    setSelectedDrillChoice("");
    setDrillError("");
    setDrillHistory((current) => (drill ? [...current, drill] : current));
    setDrill(next);
    setDrillQueue(rest);
    setDrillPendingNext(false);
    if (rest.length < 2) void generateDrillBatch({ background: true });
  }, [drillPendingNext, drillQueue, drill]);

  useEffect(() => {
    if (!readingPendingNext || !readingQueue.length) return;
    const [next, ...rest] = readingQueue;
    setReadingAnswers({});
    setReadingChecked(false);
    setReadingError("");
    setReadingHistory((current) => (readingContext ? [...current, readingContext] : current));
    setReadingContext(next);
    setReadingQueue(rest);
    setReadingPendingNext(false);
    if (rest.length < 2) void generateReadingContext({ background: true });
  }, [readingPendingNext, readingQueue, readingContext]);

  useEffect(() => {
    if (!articlePendingNext || !articleQueue.length) return;
    const [next, ...rest] = articleQueue;
    setArticleAnswers({});
    setArticleChecked(false);
    setArticleError("");
    setArticleHistory((current) => (articlePractice ? [...current, articlePractice] : current));
    setArticlePractice(next);
    setArticleQueue(rest);
    setArticlePendingNext(false);
    if (rest.length < 2) void generateArticlePractice({ background: true });
  }, [articlePendingNext, articleQueue, articlePractice]);

  useEffect(() => {
    if (!speakingPendingNext || !speakingQueue.length) return;
    const [next, ...rest] = speakingQueue;
    setSpeakingError("");
    setSpeakingHistory((current) => (speakingPractice ? [...current, speakingPractice] : current));
    setSpeakingPractice(next);
    setSpeakingQueue(rest);
    setSpeakingPendingNext(false);
    if (rest.length < 2) void generateSpeakingPractice({ background: true });
  }, [speakingPendingNext, speakingQueue, speakingPractice]);

  async function persistMessages(nextMessages: ChatMessage[]) {
    await AsyncStorage.setItem(cacheKey, JSON.stringify(nextMessages.filter((message) => !message.pending).slice(-30)));
  }

  async function persistSuggestions(nextSuggestions: string[]) {
    await AsyncStorage.setItem(suggestionKey, JSON.stringify(nextSuggestions.slice(0, 3)));
  }

  async function sendMessage(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (streaming || !text) return;
    if (!textOverride) setInput("");
    setError("");
    setStreaming(true);
    const userMessage: ChatMessage = { role: "user", content: text };
    const assistantIndex = messages.length + 1;
    const nextMessages: ChatMessage[] = [...messages, userMessage, { role: "assistant", content: "", pending: true }];
    const recentQuizAnswers = extractRecentQuizAnswers(messages);
    setMessages(nextMessages);
    try {
      await streamVocaText(
        "/v1/agent/global/chat",
        { message: text, messages: nextMessages.slice(-12), recentQuizAnswers, contextScope },
        (delta) => {
          setMessages((current) =>
            current.map((message, index) => (index === assistantIndex ? { ...message, content: message.content + delta, pending: true } : message)),
          );
        },
      );
      let finalMessages: ChatMessage[] = [];
      setMessages((current) => {
        finalMessages = current.map((message, index) => (index === assistantIndex ? { ...message, pending: false } : message));
        return finalMessages;
      });
      await persistMessages(finalMessages);
      void generateNextSuggestions(finalMessages);
    } catch (askError) {
      const message = askError instanceof Error ? askError.message : "Cannot stream assistant response.";
      setError(message);
      const failedMessages = nextMessages.map((item, index) => (index === assistantIndex ? { role: "assistant" as const, content: message } : item));
      setMessages(failedMessages);
      await persistMessages(failedMessages);
    } finally {
      setStreaming(false);
    }
  }

  async function handleRefresh() {
    Promise.all([loadCachedCards(), loadCustomAgentCardIds()]).then(([snapshot, ids]) => {
      const nextCards = snapshot?.cards || [];
      const nextTopics = Array.from(new Set(nextCards.map((c) => c.topic).filter(Boolean))).sort();
      setCards(nextCards);
      setTopics(nextTopics.slice(0, 24));
      setCustomCardIds(ids);
    }).catch(() => undefined);

    if (activeMode === "assistant") {
      setMessages([]);
      setInput("");
      setError("");
      const fallback = defaultSuggestions(contextDescription, contextCards.length);
      setSuggestions(fallback);
      await AsyncStorage.multiRemove([cacheKey, suggestionKey]);
    } else if (activeMode === "drills") {
      setDrill(null);
      setDrillQueue([]);
      setDrillHistory([]);
      setSelectedDrillChoice("");
      setDrillError("");
    } else if (activeMode === "reading") {
      setReadingContext(null);
      setReadingQueue([]);
      setReadingHistory([]);
      setReadingAnswers({});
      setReadingChecked(false);
      setReadingError("");
    } else if (activeMode === "article") {
      setArticlePractice(null);
      setArticleQueue([]);
      setArticleHistory([]);
      setArticleAnswers({});
      setArticleChecked(false);
      setArticleError("");
    } else if (activeMode === "speaking") {
      setSpeakingPractice(null);
      setSpeakingQueue([]);
      setSpeakingHistory([]);
      setSpeakingError("");
    }
  }

  async function generateNextSuggestions(nextMessages: ChatMessage[]) {
    try {
      const settings = await loadApiSettings();
      const providerSettings = llmSettingsPayload(settings);
      if (!providerSettings) return;
      const recentMessages = nextMessages.filter((message) => !message.pending).slice(-6).map((message) => ({ role: message.role, content: message.content }));
      const response = await fetch(`${normalizeBaseUrl(providerSettings.baseURL)}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerSettings.apiKey}` },
        body: JSON.stringify({
          model: providerSettings.model,
          stream: false,
          temperature: 0.25,
          messages: [
            {
              role: "system",
              content: [
                "Create 3 short follow-up prompt suggestions for the Global Voca Agent.",
                "Return only JSON in this exact shape: {\"suggestions\":[\"...\",\"...\",\"...\"]}.",
                "Suggestions should vary the task: quiz, compare confusing words, review plan, TOEIC usage, collocations, weak spots.",
                "Do not include implementation details such as JSON, schema, format, quick_quiz, or return-only instructions inside the suggestions.",
                `Active context: ${contextDescription}`,
                `Active word count: ${contextCards.length}`,
              ].join("\n"),
            },
            ...recentMessages,
          ],
        }),
      });
      if (!response.ok) throw new Error(`Suggestion request failed: ${response.status}`);
      const data = await response.json();
      const content = extractLlmResponseText(data);
      const nextSuggestions = normalizeSuggestions(parseSuggestionText(content), contextDescription, contextCards.length);
      setSuggestions(nextSuggestions);
      await persistSuggestions(nextSuggestions);
    } catch {
      const fallback = defaultSuggestions(contextDescription, contextCards.length);
      setSuggestions(fallback);
    }
  }

  async function fetchDrillBatch() {
    let raw = "";
    const finalText = await streamVocaText(
      "/v1/practice/drills",
      { message: practicePrompt("drills"), contextScope },
      (delta) => {
        raw += delta;
      },
    );
    return parseDrillText(finalText || raw, vocabularyIndex);
  }

  async function generateDrillBatch({ background = false, preserveHistory = false } = {}) {
    if (drillStreaming || drillPrefetching) return;
    if (background) setDrillPrefetching(true);
    else {
      setDrillError("");
      setSelectedDrillChoice("");
      setDrillStreaming(true);
    }
    try {
      const drills = await fetchDrillBatch();
      const [first, ...rest] = drills;
      if (!first) throw new Error("No valid drill returned.");
      if (background) {
        setDrillQueue((current) => [...current, first, ...rest].slice(0, 8));
        return;
      }
      if (preserveHistory) setDrillHistory((current) => (drill ? [...current, drill] : current));
      setDrill(first);
      if (!preserveHistory) setDrillHistory([]);
      setDrillQueue(rest);
      if (rest.length < 3) void generateDrillBatch({ background: true });
    } catch (generateError) {
      if (!background) setDrillError(generateError instanceof Error ? generateError.message : "Cannot generate drill.");
    } finally {
      if (background) setDrillPrefetching(false);
      else {
        setDrillPendingNext(false);
        setDrillStreaming(false);
      }
    }
  }

  function nextDrill() {
    setSelectedDrillChoice("");
    setDrillError("");
    if (drillQueue.length) {
      const [next, ...rest] = drillQueue;
      setDrillHistory((current) => (drill ? [...current, drill] : current));
      setDrill(next);
      setDrillQueue(rest);
      if (rest.length < 2) void generateDrillBatch({ background: true });
      return;
    }
    setDrillPendingNext(true);
    if (drillPrefetching) return;
    void generateDrillBatch({ preserveHistory: true });
  }

  function previousDrill() {
    if (!drillHistory.length) return;
    setSelectedDrillChoice("");
    setDrillError("");
    const previous = drillHistory[drillHistory.length - 1];
    setDrillHistory((current) => current.slice(0, -1));
    if (drill) setDrillQueue((current) => [drill, ...current]);
    setDrill(previous);
  }

  async function fetchReadingPractice() {
    let raw = "";
    const format: ReadingFormat = Math.random() < 0.5 ? "part6" : "part7";
    const finalText = await streamVocaText(
      "/v1/practice/reading",
      { message: practicePrompt("reading", format), contextScope },
      (delta) => {
        raw += delta;
      },
    );
    return parseReadingContext(finalText || raw);
  }

  async function generateReadingContext({ background = false, preserveHistory = false } = {}) {
    if (readingStreaming || readingPrefetching) return;
    if (background) setReadingPrefetching(true);
    else {
      setReadingError("");
      setReadingAnswers({});
      setReadingChecked(false);
      setReadingStreaming(true);
    }
    try {
      const next = await fetchReadingPractice();
      if (background) {
        setReadingQueue((current) => [...current, next].slice(0, 3));
        return;
      }
      if (preserveHistory) setReadingHistory((current) => (readingContext ? [...current, readingContext] : current));
      setReadingContext(next);
      if (!preserveHistory) setReadingHistory([]);
      if (readingQueue.length < 2) void generateReadingContext({ background: true });
    } catch (generateError) {
      if (!background) setReadingError(generateError instanceof Error ? generateError.message : "Cannot generate reading practice.");
    } finally {
      if (background) setReadingPrefetching(false);
      else {
        setReadingPendingNext(false);
        setReadingStreaming(false);
      }
    }
  }

  function nextReadingContext() {
    setReadingAnswers({});
    setReadingChecked(false);
    setReadingError("");
    if (readingQueue.length) {
      const [next, ...rest] = readingQueue;
      setReadingHistory((current) => (readingContext ? [...current, readingContext] : current));
      setReadingContext(next);
      setReadingQueue(rest);
      if (rest.length < 2) void generateReadingContext({ background: true });
      return;
    }
    setReadingPendingNext(true);
    if (readingPrefetching) return;
    void generateReadingContext({ preserveHistory: true });
  }

  function previousReadingContext() {
    if (!readingHistory.length) return;
    setReadingAnswers({});
    setReadingChecked(false);
    setReadingError("");
    const previous = readingHistory[readingHistory.length - 1];
    setReadingHistory((current) => current.slice(0, -1));
    if (readingContext) setReadingQueue((current) => [readingContext, ...current]);
    setReadingContext(previous);
  }

  async function fetchArticlePractice() {
    let raw = "";
    const finalText = await streamVocaText(
      "/v1/practice/article",
      { message: practicePrompt("article"), contextScope },
      (delta) => {
        raw += delta;
      },
    );
    return parseArticlePractice(finalText || raw);
  }

  async function generateArticlePractice({ background = false, preserveHistory = false } = {}) {
    if (articleStreaming || articlePrefetching) return;
    if (background) setArticlePrefetching(true);
    else {
      setArticleError("");
      setArticleAnswers({});
      setArticleChecked(false);
      setArticleStreaming(true);
    }
    try {
      const next = await fetchArticlePractice();
      if (background) {
        setArticleQueue((current) => [...current, next].slice(0, 3));
        return;
      }
      if (preserveHistory) setArticleHistory((current) => (articlePractice ? [...current, articlePractice] : current));
      setArticlePractice(next);
      if (!preserveHistory) setArticleHistory([]);
      if (articleQueue.length < 2) void generateArticlePractice({ background: true });
    } catch (generateError) {
      if (!background) setArticleError(generateError instanceof Error ? generateError.message : "Cannot generate article practice.");
    } finally {
      if (background) setArticlePrefetching(false);
      else {
        setArticlePendingNext(false);
        setArticleStreaming(false);
      }
    }
  }

  function nextArticlePractice() {
    setArticleAnswers({});
    setArticleChecked(false);
    setArticleError("");
    if (articleQueue.length) {
      const [next, ...rest] = articleQueue;
      setArticleHistory((current) => (articlePractice ? [...current, articlePractice] : current));
      setArticlePractice(next);
      setArticleQueue(rest);
      if (rest.length < 2) void generateArticlePractice({ background: true });
      return;
    }
    setArticlePendingNext(true);
    if (articlePrefetching) return;
    void generateArticlePractice({ preserveHistory: true });
  }

  function previousArticlePractice() {
    if (!articleHistory.length) return;
    setArticleAnswers({});
    setArticleChecked(false);
    setArticleError("");
    const previous = articleHistory[articleHistory.length - 1];
    setArticleHistory((current) => current.slice(0, -1));
    if (articlePractice) setArticleQueue((current) => [articlePractice, ...current]);
    setArticlePractice(previous);
  }

  async function fetchSpeakingPractice() {
    let raw = "";
    const finalText = await streamVocaText(
      "/v1/practice/speaking",
      { message: practicePrompt("speaking"), contextScope },
      (delta) => {
        raw += delta;
      },
    );
    return parseSpeakingPractice(finalText || raw);
  }

  async function generateSpeakingPractice({ background = false, preserveHistory = false } = {}) {
    if (speakingStreaming || speakingPrefetching) return;
    if (background) setSpeakingPrefetching(true);
    else {
      setSpeakingError("");
      setSpeakingStreaming(true);
    }
    try {
      const next = await fetchSpeakingPractice();
      if (background) {
        setSpeakingQueue((current) => [...current, next].slice(0, 3));
        return;
      }
      if (preserveHistory) setSpeakingHistory((current) => (speakingPractice ? [...current, speakingPractice] : current));
      setSpeakingPractice(next);
      if (!preserveHistory) setSpeakingHistory([]);
      if (speakingQueue.length < 2) void generateSpeakingPractice({ background: true });
    } catch (generateError) {
      if (!background) setSpeakingError(generateError instanceof Error ? generateError.message : "Cannot generate speaking practice.");
    } finally {
      if (background) setSpeakingPrefetching(false);
      else {
        setSpeakingPendingNext(false);
        setSpeakingStreaming(false);
      }
    }
  }

  function nextSpeakingPractice() {
    setSpeakingError("");
    if (speakingQueue.length) {
      const [next, ...rest] = speakingQueue;
      setSpeakingHistory((current) => (speakingPractice ? [...current, speakingPractice] : current));
      setSpeakingPractice(next);
      setSpeakingQueue(rest);
      if (rest.length < 2) void generateSpeakingPractice({ background: true });
      return;
    }
    setSpeakingPendingNext(true);
    if (speakingPrefetching) return;
    void generateSpeakingPractice({ preserveHistory: true });
  }

  function previousSpeakingPractice() {
    if (!speakingHistory.length) return;
    setSpeakingError("");
    const previous = speakingHistory[speakingHistory.length - 1];
    setSpeakingHistory((current) => current.slice(0, -1));
    if (speakingPractice) setSpeakingQueue((current) => [speakingPractice, ...current]);
    setSpeakingPractice(previous);
  }

  return (
    <SafeAreaView edges={[]} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0} style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Global Agent</Text>
            <View style={styles.contextRow}>
              <Text numberOfLines={1} style={styles.subtitle}>{contextCards.length.toLocaleString()} / {cards.length.toLocaleString()} words</Text>
              <CompactContextSelector
                cards={cards}
                customCount={customCardIds.length}
                customCardIds={customCardIds}
                dateFrom={dateFrom}
                dateTo={dateTo}
                level={level}
                onCustomCardIdsChange={(nextIds) => {
                  setCustomCardIds(nextIds);
                  void saveCustomAgentCardIds(nextIds);
                }}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onLevelChange={setLevel}
                onScopeTypeChange={setScopeType}
                onTopicChange={setTopic}
                scopeType={scopeType}
                topic={topic}
                topics={topics}
              />
            </View>
          </View>
          {(activeMode === "assistant" ? streaming : activeMode === "drills" ? drillStreaming : activeMode === "reading" ? readingStreaming : activeMode === "article" ? articleStreaming : speakingStreaming) ? (
            <View style={styles.loadingPill}>
              <ActivityIndicator color={colors.accentStrong} size="small" />
              <Text style={styles.loadingPillText}>Loading</Text>
            </View>
          ) : (
            <Pressable accessibilityLabel="Refresh" onPress={() => void handleRefresh()} style={styles.iconButton}>
              <Ionicons color={colors.ink} name="refresh" size={20} />
            </Pressable>
          )}
        </View>

        <View style={styles.modeTabs}>
          {agentModes.map((mode) => (
            <Pressable key={mode.value} onPress={() => { animateNextLayout(); setActiveMode(mode.value); }} style={[styles.modeTab, activeMode === mode.value && styles.modeTabActive]}>
              <Text style={[styles.modeTabText, activeMode === mode.value && styles.modeTabTextActive]}>{mode.title}</Text>
            </Pressable>
          ))}
        </View>

        {activeMode === "assistant" ? (
          <>
            <ScrollView ref={scrollRef} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" style={styles.messagesViewport}>
              {messages.map((message, index) => (
                <ChatBubble key={`${message.role}-${index}`} message={message} onSubmitQuizResults={(summary) => void sendMessage(summary)} />
              ))}
            </ScrollView>

            <View style={[styles.composer, { paddingBottom: spacing.xs }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionList}>
                {suggestions.map((suggestion) => (
                  <Pressable key={suggestion} disabled={streaming} onPress={() => void sendMessage(suggestion)} style={styles.suggestionChip}>
                    <Text style={styles.suggestionText}>{shortSuggestionLabel(suggestion)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.inputRow}>
                <TextInput multiline onChangeText={setInput} placeholder="Ask the global agent..." style={styles.input} value={input} />
                <Pressable disabled={streaming || !input.trim()} onPress={() => void sendMessage()} style={[styles.sendButton, (streaming || !input.trim()) && styles.sendButtonDisabled]}>
                  <Ionicons color="#ffffff" name="send" size={18} />
                </Pressable>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          </>
        ) : activeMode === "drills" ? (
          <DrillsPanel
            drill={drill}
            error={drillError}
            onGenerate={() => void generateDrillBatch()}
            onNext={nextDrill}
            onPrevious={previousDrill}
            onResetCurrent={() => { animateNextLayout(); setSelectedDrillChoice(""); }}
            onSelect={setSelectedDrillChoice}
            pendingNext={drillPendingNext}
            previousEnabled={drillHistory.length > 0}
            selectedChoice={selectedDrillChoice}
            streaming={drillStreaming}
            prefetching={drillPrefetching}
          />
        ) : activeMode === "reading" ? (
          <ReadingPanel
            answers={readingAnswers}
            checked={readingChecked}
            context={readingContext}
            error={readingError}
            onCheck={() => setReadingChecked(true)}
            onGenerate={() => void generateReadingContext()}
            onNext={nextReadingContext}
            onPrevious={previousReadingContext}
            onResetCurrent={() => {
              animateNextLayout();
              setReadingAnswers({});
              setReadingChecked(false);
            }}
            onSelect={(key, choice) => {
              setReadingAnswers((current) => ({ ...current, [key]: choice }));
              setReadingChecked(false);
            }}
            pendingNext={readingPendingNext}
            prefetching={readingPrefetching}
            previousEnabled={readingHistory.length > 0}
            streaming={readingStreaming}
          />
        ) : activeMode === "article" ? (
          <ArticlePanel
            answers={articleAnswers}
            article={articlePractice}
            checked={articleChecked}
            error={articleError}
            onCheck={() => setArticleChecked(true)}
            onGenerate={() => void generateArticlePractice()}
            onNext={nextArticlePractice}
            onPrevious={previousArticlePractice}
            onResetCurrent={() => {
              animateNextLayout();
              setArticleAnswers({});
              setArticleChecked(false);
            }}
            onSelect={(key, choice) => {
              setArticleAnswers((current) => ({ ...current, [key]: choice }));
              setArticleChecked(false);
            }}
            pendingNext={articlePendingNext}
            prefetching={articlePrefetching}
            previousEnabled={articleHistory.length > 0}
            streaming={articleStreaming}
          />
        ) : (
          <SpeakingPanel
            practice={speakingPractice}
            error={speakingError}
            onGenerate={() => void generateSpeakingPractice()}
            onNext={nextSpeakingPractice}
            onPrevious={previousSpeakingPractice}
            onResetCurrent={() => {
              animateNextLayout();
            }}
            pendingNext={speakingPendingNext}
            prefetching={speakingPrefetching}
            previousEnabled={speakingHistory.length > 0}
            streaming={speakingStreaming}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChatBubble({ message, onSubmitQuizResults }: { message: ChatMessage; onSubmitQuizResults: (summary: string) => void }) {
  const isUser = message.role === "user";
  const hasQuiz = !isUser && !message.pending && Boolean(maybeParseQuickQuiz(message.content));
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser, hasQuiz && styles.bubbleRowQuiz]}>
      <View style={[styles.avatar, isUser ? styles.avatarUser : styles.avatarAgent]}>
        <Text style={[styles.avatarText, isUser && styles.avatarTextUser]}>{isUser ? "You" : "AI"}</Text>
      </View>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble, hasQuiz && styles.quizBubble]}>
        {isUser ? (
          <Text style={styles.userText}>{message.content}</Text>
        ) : message.pending && !message.content ? (
          <TypingDots />
        ) : message.pending && isLikelyStructuredQuiz(message.content) ? (
          <Text style={styles.generatingText}>Generating quiz...</Text>
        ) : (
          <AssistantMessageContent content={message.content} onSubmitQuizResults={onSubmitQuizResults} />
        )}
      </View>
    </View>
  );
}

function DrillsPanel({
  drill,
  selectedChoice,
  streaming,
  prefetching,
  error,
  onGenerate,
  onNext,
  onPrevious,
  onResetCurrent,
  onSelect,
  pendingNext,
  previousEnabled,
}: {
  drill: ChallengeDrill | null;
  selectedChoice: string;
  streaming: boolean;
  prefetching: boolean;
  pendingNext: boolean;
  error: string;
  onGenerate: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onResetCurrent: () => void;
  onSelect: (choice: string) => void;
  previousEnabled: boolean;
}) {
  const correct = Boolean(selectedChoice && drill && normalizeAnswer(selectedChoice) === normalizeAnswer(drill.answer));
  return (
    <View style={styles.drillRoot}>
      <ScrollView contentContainerStyle={styles.drillPanel} style={styles.messagesViewport}>
        <View style={styles.drillToolbar}>
          <Text style={styles.drillToolbarText}>Scenarios, traps, reverse dictionary, and Part 2 responses.</Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {drill ? (
          <View style={styles.drillCard}>
            <View style={styles.drillTypeRow}>
              <Text style={styles.drillKind}>{drillKindLabel(drill.kind)}</Text>
              {drill.difficulty ? <Text style={styles.drillMeta}>{drill.difficulty}</Text> : null}
            </View>
            {drill.title ? <Text style={styles.drillTitle}>{drill.title}</Text> : null}
            {drill.instruction ? <Text style={styles.drillInstruction}>{drill.instruction}</Text> : null}
            <View style={styles.audioTextRow}>
              <Text style={[styles.drillScenario, styles.audioText]}>{drill.scenario}</Text>
              <TextAudioButton text={drill.scenario} />
            </View>
            <View style={styles.drillChoices}>
              {drill.choices.map((choice, index) => {
                const chosen = selectedChoice === choice;
                const isAnswer = normalizeAnswer(choice) === normalizeAnswer(drill.answer);
                const showCorrect = Boolean(selectedChoice && isAnswer);
                const showWrong = Boolean(chosen && selectedChoice && !isAnswer);
                return (
                  <Pressable
                    key={choice}
                    disabled={Boolean(selectedChoice)}
                    onPress={() => { animateNextLayout(); onSelect(choice); }}
                    style={[styles.drillChoice, chosen && styles.drillChoiceSelected, showCorrect && styles.drillChoiceCorrect, showWrong && styles.drillChoiceWrong]}
                  >
                    <Text style={[styles.drillChoiceLabel, (chosen || showCorrect) && styles.drillChoiceLabelActive]}>{drillChoiceLabel(index)}</Text>
                    <Text style={[styles.drillChoiceText, chosen && styles.drillChoiceTextSelected, showCorrect && styles.drillChoiceTextCorrect, showWrong && styles.drillChoiceTextWrong]}>{choice}</Text>
                    <TextAudioButton text={choice} />
                  </Pressable>
                );
              })}
            </View>
            {selectedChoice ? (
              <View style={[styles.drillFeedback, correct ? styles.drillFeedbackCorrect : styles.drillFeedbackWrong]}>
                <Text style={[styles.drillFeedbackTitle, correct ? styles.feedbackCorrect : styles.feedbackWrong]}>
                  {correct ? "Correct" : `Not quite. Correct: ${drill.answer}`}
                </Text>
                <View style={styles.audioTextRow}>
                  <Text style={[styles.drillFeedbackText, styles.audioText]}>
                    {correct ? drill.explanation : drill.whyWrong?.[selectedChoice] || drill.explanation}
                  </Text>
                  <TextAudioButton text={correct ? drill.explanation : drill.whyWrong?.[selectedChoice] || drill.explanation} />
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.drillActionBar}>
        {!drill ? (
          <Pressable disabled={streaming} onPress={onGenerate} style={[styles.fullWidthGenerateButton, streaming && styles.sendButtonDisabled]}>
            {streaming ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons color="#ffffff" name="sparkles" size={15} />}
            <Text style={styles.compactButtonTextPrimary}>{streaming ? "Generating" : "Generate"}</Text>
          </Pressable>
        ) : (
          <View style={styles.drillActions}>
            <Pressable disabled={streaming || pendingNext} onPress={onResetCurrent} style={[styles.drillResetButton, (streaming || pendingNext) && styles.sendButtonDisabled]}>
              <Ionicons color={colors.accentStrong} name="refresh" size={16} />
            </Pressable>
            <Pressable disabled={streaming || pendingNext || !previousEnabled} onPress={onPrevious} style={[styles.drillNavButton, (streaming || pendingNext || !previousEnabled) && styles.sendButtonDisabled]}>
              <Ionicons color={colors.accentStrong} name="arrow-back" size={15} />
              <Text style={styles.compactButtonText}>Previous</Text>
            </Pressable>
            <Pressable disabled={streaming || pendingNext} onPress={onNext} style={[styles.drillNavButton, (streaming || pendingNext) && styles.sendButtonDisabled]}>
              {(streaming && !prefetching) || pendingNext ? <ActivityIndicator color={colors.accentStrong} size="small" /> : <Ionicons color={colors.accentStrong} name="arrow-forward" size={15} />}
              <Text style={styles.compactButtonText}>Next</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function ReadingPanel({
  context,
  answers,
  checked,
  streaming,
  prefetching,
  pendingNext,
  error,
  previousEnabled,
  onGenerate,
  onNext,
  onPrevious,
  onResetCurrent,
  onSelect,
  onCheck,
}: {
  context: ReadingContext | null;
  answers: Record<number, string>;
  checked: boolean;
  streaming: boolean;
  prefetching: boolean;
  pendingNext: boolean;
  error: string;
  previousEnabled: boolean;
  onGenerate: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onResetCurrent: () => void;
  onSelect: (key: number, choice: string) => void;
  onCheck: () => void;
}) {
  return (
    <PracticeObjectPanel
      emptyLabel="Generate"
      error={error}
      hasContent={Boolean(context)}
      onGenerate={onGenerate}
      onNext={onNext}
      onPrevious={onPrevious}
      onResetCurrent={onResetCurrent}
      pendingNext={pendingNext}
      prefetching={prefetching}
      previousEnabled={previousEnabled}
      resetEnabled={Boolean(context)}
      streaming={streaming}
      toolbarText="Random TOEIC Part 6 or Part 7 passage with A/B/C/D questions."
    >
      {context ? <ReadingContextCard context={context} answers={answers} checked={checked} onCheck={onCheck} onSelect={onSelect} /> : null}
    </PracticeObjectPanel>
  );
}

function ArticlePanel({
  article,
  answers,
  checked,
  streaming,
  prefetching,
  pendingNext,
  error,
  previousEnabled,
  onGenerate,
  onNext,
  onPrevious,
  onResetCurrent,
  onSelect,
  onCheck,
}: {
  article: ArticlePractice | null;
  answers: Record<number, string>;
  checked: boolean;
  streaming: boolean;
  prefetching: boolean;
  pendingNext: boolean;
  error: string;
  previousEnabled: boolean;
  onGenerate: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onResetCurrent: () => void;
  onSelect: (key: number, choice: string) => void;
  onCheck: () => void;
}) {
  return (
    <PracticeObjectPanel
      emptyLabel="Generate"
      error={error}
      hasContent={Boolean(article)}
      onGenerate={onGenerate}
      onNext={onNext}
      onPrevious={onPrevious}
      onResetCurrent={onResetCurrent}
      pendingNext={pendingNext}
      prefetching={prefetching}
      previousEnabled={previousEnabled}
      resetEnabled={Boolean(article)}
      streaming={streaming}
      toolbarText="Business article practice with vocabulary notes and context questions."
    >
      {article ? <ArticlePracticeCard article={article} answers={answers} checked={checked} onCheck={onCheck} onSelect={onSelect} /> : null}
    </PracticeObjectPanel>
  );
}

function SpeakingPanel({
  practice,
  streaming,
  prefetching,
  pendingNext,
  error,
  previousEnabled,
  onGenerate,
  onNext,
  onPrevious,
  onResetCurrent,
}: {
  practice: SpeakingPractice | null;
  streaming: boolean;
  prefetching: boolean;
  pendingNext: boolean;
  error: string;
  previousEnabled: boolean;
  onGenerate: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onResetCurrent: () => void;
}) {
  return (
    <PracticeObjectPanel
      emptyLabel="Generate"
      error={error}
      hasContent={Boolean(practice)}
      onGenerate={onGenerate}
      onNext={onNext}
      onPrevious={onPrevious}
      onResetCurrent={onResetCurrent}
      pendingNext={pendingNext}
      prefetching={prefetching}
      previousEnabled={previousEnabled}
      resetEnabled={Boolean(practice)}
      streaming={streaming}
      toolbarText="Practice speaking and shadowing (karaoke style) with IPA and timing."
    >
      {practice ? <SpeakingPracticeCard practice={practice} /> : null}
    </PracticeObjectPanel>
  );
}

function SpeakingPracticeCard({ practice }: { practice: SpeakingPractice }) {
  const [shadowingEnabled, setShadowingEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState("");

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const scrollRef = useRef<ScrollView>(null);
  const sentenceOffsets = useRef<Record<number, number>>({});

  const totalDurationMs = useMemo(() => {
    if (!practice.sentences.length) return 0;
    const lastSent = practice.sentences[practice.sentences.length - 1];
    if (!lastSent.words.length) return 0;
    return lastSent.words[lastSent.words.length - 1].endMs;
  }, [practice]);

  useEffect(() => {
    player.muted = isMuted;
    player.volume = isMuted ? 0 : 1;
  }, [isMuted, player]);

  async function togglePlay() {
    if (isPlaying) {
      if (shadowingEnabled) {
        player.pause();
      }
      setIsPlaying(false);
    } else {
      if (shadowingEnabled) {
        setAudioLoading(true);
        setPlaybackError("");
        try {
          const source = await ensureTextAudio(practice.passageText);
          player.replace({ uri: source.uri });
          player.muted = isMuted;
          player.volume = isMuted ? 0 : 1;
          await player.seekTo(progressMs / 1000);
          player.play();
          setIsPlaying(true);
        } catch (err) {
          setPlaybackError(err instanceof Error ? err.message : "Failed to load audio.");
          setIsPlaying(true);
        } finally {
          setAudioLoading(false);
        }
      } else {
        setIsPlaying(true);
      }
    }
  }

  function handleStop() {
    if (shadowingEnabled) {
      player.pause();
      void player.seekTo(0).catch(() => undefined);
    }
    setIsPlaying(false);
    setProgressMs(0);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  function handleShadowingToggle() {
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
    }
    setShadowingEnabled(!shadowingEnabled);
    setProgressMs(0);
  }

  useEffect(() => {
    if (!isPlaying) return;

    let animFrameId: number;
    let lastTime = Date.now();

    const tick = () => {
      if (shadowingEnabled && player.currentStatus) {
        const curMs = player.currentStatus.currentTime * 1000;
        setProgressMs(curMs);
        if (player.currentStatus.didJustFinish) {
          setIsPlaying(false);
          setProgressMs(0);
          void player.seekTo(0).catch(() => undefined);
        }
      } else if (!shadowingEnabled) {
        const now = Date.now();
        const delta = now - lastTime;
        lastTime = now;
        setProgressMs((prev) => {
          const next = prev + delta;
          if (next >= totalDurationMs) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }
      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId);
  }, [isPlaying, shadowingEnabled, totalDurationMs, player]);

  const activeSentenceIdx = useMemo(() => {
    for (let i = 0; i < practice.sentences.length; i++) {
      const sent = practice.sentences[i];
      if (!sent.words.length) continue;
      const startMs = sent.words[0].startMs;
      const endMs = sent.words[sent.words.length - 1].endMs;
      if (progressMs >= startMs && progressMs <= endMs) {
        return i;
      }
    }
    return 0;
  }, [practice.sentences, progressMs]);

  useEffect(() => {
    const y = sentenceOffsets.current[activeSentenceIdx];
    if (y !== undefined) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 40), animated: true });
    }
  }, [activeSentenceIdx]);

  return (
    <View style={styles.speakingRoot}>
      <View style={styles.speakingHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.speakingTitle}>{practice.title}</Text>
          {practice.topic ? <Text style={styles.speakingSub}>Topic: {practice.topic}</Text> : null}
        </View>
        {audioLoading && <ActivityIndicator color={colors.accent} size="small" />}
      </View>

      {playbackError ? <Text style={styles.error}>{playbackError}</Text> : null}

      <View style={styles.speakingControls}>
        <Pressable onPress={togglePlay} style={[styles.controlBtn, isPlaying && styles.controlBtnActive]}>
          <Ionicons color={isPlaying ? colors.accentStrong : colors.ink} name={isPlaying ? "pause" : "play"} size={16} />
          <Text style={[styles.controlBtnText, isPlaying && styles.controlBtnTextActive]}>
            {isPlaying ? "Pause" : "Start"}
          </Text>
        </Pressable>

        <Pressable onPress={handleStop} style={styles.controlBtn}>
          <Ionicons color={colors.ink} name="square" size={16} />
          <Text style={styles.controlBtnText}>Stop</Text>
        </Pressable>

        <Pressable onPress={handleShadowingToggle} style={[styles.controlBtn, shadowingEnabled && styles.controlBtnActive]}>
          <Ionicons color={shadowingEnabled ? colors.accentStrong : colors.ink} name="headset" size={16} />
          <Text style={[styles.controlBtnText, shadowingEnabled && styles.controlBtnTextActive]}>
            {shadowingEnabled ? "Voice ON" : "Voice OFF"}
          </Text>
        </Pressable>

        {shadowingEnabled && (
          <Pressable onPress={() => setIsMuted(!isMuted)} style={[styles.controlBtn, !isMuted && styles.controlBtnActive]}>
            <Ionicons color={!isMuted ? colors.accentStrong : colors.muted} name={isMuted ? "volume-mute" : "volume-high"} size={16} />
            <Text style={[styles.controlBtnText, !isMuted && styles.controlBtnTextActive]}>
              {isMuted ? "Muted" : "Sound"}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollContainer}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {practice.sentences.map((sent, sentIdx) => {
          const isActive = sentIdx === activeSentenceIdx;
          return (
            <View
              key={sentIdx}
              onLayout={(event) => {
                sentenceOffsets.current[sentIdx] = event.nativeEvent.layout.y;
              }}
              style={[
                styles.sentenceContainer,
                isActive && styles.sentenceActive,
              ]}
            >
              <View style={styles.speakingWordWrap}>
                {sent.words.map((w, wIdx) => {
                  const isWordActive = progressMs >= w.startMs && progressMs < w.endMs;
                  const liaison = sent.connectedSpeech.find(
                    (c) => c.from.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "") === w.word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
                  );

                  return (
                    <View
                      key={wIdx}
                      style={[
                        styles.wordColumn,
                        isWordActive && styles.wordColumnActive,
                      ]}
                    >
                      <Text style={[styles.wordText, isWordActive && styles.wordTextActive]}>
                        {w.word}
                        {liaison && liaison.symbol ? (
                          <Text style={styles.liaisonSymbol}>{liaison.symbol}</Text>
                        ) : null}
                      </Text>
                      <Text style={[styles.wordIpa, isWordActive && styles.wordIpaActive]}>
                        {w.ipa}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {practice.sentences.some(s => s.connectedSpeech?.length > 0) && (
        <View style={styles.linkingNotes}>
          <Text style={styles.linkingNotesTitle}>Connected Speech (Luyện nối âm)</Text>
          {practice.sentences.flatMap((s, sIdx) => s.connectedSpeech.map((c, cIdx) => (
            <View key={`${sIdx}-${cIdx}`} style={styles.linkingNoteRow}>
              <Ionicons color="#16a34a" name="link-outline" size={14} style={{ marginTop: 2 }} />
              <Text style={styles.linkingNoteText}>
                Đọc nối: "{c.from}" {c.symbol || "‿"} "{c.to}" ({c.type === "linking" ? "Nối âm" : c.type === "elision" ? "Nuốt âm" : c.type})
                {c.explanation ? ` - ${c.explanation}` : ""}
              </Text>
            </View>
          )))}
        </View>
      )}
    </View>
  );
}

function PracticeObjectPanel({
  children,
  toolbarText,
  error,
  hasContent,
  streaming,
  prefetching,
  pendingNext,
  previousEnabled,
  resetEnabled,
  emptyLabel,
  onGenerate,
  onNext,
  onPrevious,
  onResetCurrent,
}: {
  children: ReactNode;
  toolbarText: string;
  error: string;
  hasContent: boolean;
  streaming: boolean;
  prefetching: boolean;
  pendingNext: boolean;
  previousEnabled: boolean;
  resetEnabled: boolean;
  emptyLabel: string;
  onGenerate: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onResetCurrent: () => void;
}) {
  return (
    <View style={styles.drillRoot}>
      <ScrollView contentContainerStyle={styles.drillPanel} style={styles.messagesViewport}>
        <View style={styles.drillToolbar}>
          <Text style={styles.drillToolbarText}>{toolbarText}</Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {children}
      </ScrollView>
      <View style={styles.drillActionBar}>
        {!hasContent ? (
          <Pressable disabled={streaming} onPress={onGenerate} style={[styles.fullWidthGenerateButton, streaming && styles.sendButtonDisabled]}>
            {streaming ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons color="#ffffff" name="sparkles" size={15} />}
            <Text style={styles.compactButtonTextPrimary}>{streaming ? "Generating" : emptyLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.drillActions}>
            <Pressable disabled={!resetEnabled || streaming || pendingNext} onPress={onResetCurrent} style={[styles.drillResetButton, (!resetEnabled || streaming || pendingNext) && styles.sendButtonDisabled]}>
              <Ionicons color={colors.accentStrong} name="refresh" size={16} />
            </Pressable>
            <Pressable disabled={streaming || pendingNext || !previousEnabled} onPress={onPrevious} style={[styles.drillNavButton, (streaming || pendingNext || !previousEnabled) && styles.sendButtonDisabled]}>
              <Ionicons color={colors.accentStrong} name="arrow-back" size={15} />
              <Text style={styles.compactButtonText}>Previous</Text>
            </Pressable>
            <Pressable disabled={streaming || pendingNext} onPress={onNext} style={[styles.drillNavButton, (streaming || pendingNext) && styles.sendButtonDisabled]}>
              {(streaming && !prefetching) || pendingNext ? <ActivityIndicator color={colors.accentStrong} size="small" /> : <Ionicons color={colors.accentStrong} name="arrow-forward" size={15} />}
              <Text style={styles.compactButtonText}>Next</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function ReadingContextCard({
  context,
  answers,
  checked,
  onSelect,
  onCheck,
}: {
  context: ReadingContext;
  answers: Record<number, string>;
  checked: boolean;
  onSelect: (key: number, choice: string) => void;
  onCheck: () => void;
}) {
  const documents =
    context.format === "part7" && context.documents?.length
      ? context.documents
      : [{ title: context.title, documentType: context.documentType, passage: context.passage }];
  const [activeDocumentIndex, setActiveDocumentIndex] = useState(0);
  const [passageWidth, setPassageWidth] = useState(0);
  const passagePagerRef = useRef<ScrollView>(null);
  const activeDocument = documents[Math.min(activeDocumentIndex, documents.length - 1)] || documents[0];
  const activePassageText = activeDocument.passage.map((line) => formatReadingLine(line, context.format)).join("\n");
  const correctCount = context.questions.filter((question, index) => normalizeAnswer(answers[readingAnswerKey(question, index)] || "") === normalizeAnswer(question.answer)).length;

  useEffect(() => {
    setActiveDocumentIndex(0);
  }, [context.title, context.format, documents.length]);

  useEffect(() => {
    if (!passageWidth || context.format !== "part7" || documents.length <= 1) return;
    passagePagerRef.current?.scrollTo({ x: activeDocumentIndex * passageWidth, animated: true });
  }, [activeDocumentIndex, passageWidth, context.format, documents.length]);

  function selectDocument(index: number) {
    setActiveDocumentIndex(index);
  }

  function handleDocumentSwipe(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!passageWidth) return;
    const index = Math.round(event.nativeEvent.contentOffset.x / passageWidth);
    setActiveDocumentIndex(Math.max(0, Math.min(documents.length - 1, index)));
  }

  return (
    <View style={styles.readingCard}>
      <View style={styles.readingHeader}>
        <View style={styles.practiceHeaderCopy}>
          <Text style={styles.readingEyebrow}>TOEIC {context.format === "part6" ? "Part 6" : "Part 7"} · {documentTypeLabel(context.documentType)}</Text>
          <Text style={styles.readingTitle}>{context.title}</Text>
        </View>
        {checked ? <Text style={styles.quizScore}>{correctCount}/{context.questions.length}</Text> : null}
      </View>
      {context.format === "part7" && documents.length > 1 ? (
        <View
          onLayout={(event) => setPassageWidth(event.nativeEvent.layout.width)}
          style={styles.readingPassagePager}
        >
          <ScrollView
            horizontal
            onMomentumScrollEnd={handleDocumentSwipe}
            pagingEnabled
            ref={passagePagerRef}
            showsHorizontalScrollIndicator={false}
          >
            {documents.map((document, documentIndex) => (
              <View key={`${document.title}-${documentIndex}`} style={[styles.readingPassage, passageWidth ? { width: passageWidth } : null]}>
                <View style={styles.readingPassageHeader}>
                  <Text style={[styles.documentLabel, styles.audioText]}>{documentTypeLabel(document.documentType || context.documentType)}{document.title ? ` · ${document.title}` : ""}</Text>
                  <TextAudioButton text={document.passage.map((line) => formatReadingLine(line, context.format)).join("\n")} />
                </View>
                {document.passage.map((line, lineIndex) => (
                  <Text key={`${line}-${lineIndex}`} style={styles.passageLine}>{formatReadingLine(line, context.format)}</Text>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.readingPassage}>
          <View style={styles.readingPassageHeader}>
            <View style={styles.audioText} />
            <TextAudioButton text={activePassageText} />
          </View>
          {activeDocument.passage.map((line, index) => (
            <Text key={`${line}-${index}`} style={styles.passageLine}>{formatReadingLine(line, context.format)}</Text>
          ))}
        </View>
      )}
      {context.format === "part7" && documents.length > 1 ? (
        <View style={styles.documentTabs}>
          {documents.map((document, index) => (
            <Pressable key={`${document.title}-${index}`} onPress={() => selectDocument(index)} style={[styles.documentTab, activeDocumentIndex === index && styles.documentTabActive]}>
              <Text style={[styles.documentTabText, activeDocumentIndex === index && styles.documentTabTextActive]}>{index + 1}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <QuestionList questions={context.questions} answers={answers} checked={checked} keyForQuestion={readingAnswerKey} modeLabel={context.format} onSelect={onSelect} />
      <CheckAnswersButton disabled={!context.questions.some((question, index) => answers[readingAnswerKey(question, index)]) || checked} onPress={onCheck} />
    </View>
  );
}

function ArticlePracticeCard({
  article,
  answers,
  checked,
  onSelect,
  onCheck,
}: {
  article: ArticlePractice;
  answers: Record<number, string>;
  checked: boolean;
  onSelect: (key: number, choice: string) => void;
  onCheck: () => void;
}) {
  const correctCount = article.questions.filter((question, index) => normalizeAnswer(answers[index] || "") === normalizeAnswer(question.answer)).length;
  const passageText = article.passage.join("\n");
  return (
    <View style={styles.readingCard}>
      <View style={styles.readingHeader}>
        <View style={styles.practiceHeaderCopy}>
          <Text style={styles.readingEyebrow}>Article Practice · {documentTypeLabel(article.documentType)}</Text>
          <Text style={styles.readingTitle}>{article.title}</Text>
        </View>
        {checked ? <Text style={styles.quizScore}>{correctCount}/{article.questions.length}</Text> : null}
      </View>
      <View style={styles.readingPassage}>
        <View style={styles.readingPassageHeader}>
          <View style={styles.audioText} />
          <TextAudioButton text={passageText} />
        </View>
        {article.passage.map((line, index) => (
          <Text key={`${line}-${index}`} style={styles.passageLine}>{line}</Text>
        ))}
      </View>
      <View style={styles.vocabNotes}>
        <Text style={styles.readingSectionTitle}>Vocabulary Notes</Text>
        {article.vocabularyNotes.map((note) => (
          <View key={note.word} style={styles.vocabNote}>
            <View style={styles.audioTextRow}>
              <Text style={[styles.vocabWord, styles.audioText]}>{note.word}</Text>
              <TextAudioButton text={note.word} />
            </View>
            <Text style={styles.vocabMeaning}>{note.contextMeaning} · {note.meaningVi}</Text>
          </View>
        ))}
      </View>
      <QuestionList questions={article.questions} answers={answers} checked={checked} keyForQuestion={(_, index) => index} modeLabel="article" onSelect={onSelect} />
      <CheckAnswersButton disabled={!article.questions.some((_, index) => answers[index]) || checked} onPress={onCheck} />
    </View>
  );
}

function QuestionList({
  questions,
  answers,
  checked,
  keyForQuestion,
  modeLabel,
  onSelect,
}: {
  questions: ReadingQuestion[];
  answers: Record<number, string>;
  checked: boolean;
  keyForQuestion: (question: ReadingQuestion, index: number) => number;
  modeLabel: ReadingFormat | "article";
  onSelect: (key: number, choice: string) => void;
}) {
  return (
    <View style={styles.readingQuestions}>
      {questions.map((question, questionIndex) => {
        const key = keyForQuestion(question, questionIndex);
        const selected = answers[key] || "";
        const correct = checked && normalizeAnswer(selected) === normalizeAnswer(question.answer);
        const wrong = checked && Boolean(selected) && !correct;
        return (
          <View key={`${question.prompt}-${questionIndex}`} style={[styles.readingQuestion, correct && styles.readingQuestionCorrect, wrong && styles.readingQuestionWrong]}>
            <Text style={styles.readingQuestionPrompt}>
              {modeLabel === "part6" ? `[${question.blank}]` : `${questionIndex + 1}.`} {question.prompt}
            </Text>
            <View style={styles.drillChoices}>
              {question.choices.map((choice, index) => {
                const chosen = normalizeAnswer(selected) === normalizeAnswer(choice);
                const isAnswer = normalizeAnswer(choice) === normalizeAnswer(question.answer);
                const showCorrect = checked && isAnswer;
                const showWrong = checked && chosen && !isAnswer;
                return (
                  <Pressable
                    key={choice}
                    disabled={checked}
                    onPress={() => { animateNextLayout(); onSelect(key, choice); }}
                    style={[styles.drillChoice, chosen && styles.drillChoiceSelected, showCorrect && styles.drillChoiceCorrect, showWrong && styles.drillChoiceWrong]}
                  >
                    <Text style={[styles.drillChoiceLabel, (chosen || showCorrect) && styles.drillChoiceLabelActive]}>{drillChoiceLabel(index)}</Text>
                    <Text style={[styles.drillChoiceText, chosen && styles.drillChoiceTextSelected, showCorrect && styles.drillChoiceTextCorrect, showWrong && styles.drillChoiceTextWrong]}>{choice}</Text>
                  </Pressable>
                );
              })}
            </View>
            {checked ? (
              <View style={styles.audioTextRow}>
                <Text style={[styles.readingFeedback, styles.audioText, correct ? styles.feedbackCorrect : styles.feedbackWrong]}>
                  {correct ? "Correct" : `Answer: ${question.answer}`} {question.explanation ? `· ${question.explanation}` : ""}
                </Text>
                <TextAudioButton text={`${correct ? "Correct" : `Answer: ${question.answer}`}. ${question.explanation || ""}`} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function CheckAnswersButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={() => { animateNextLayout(); onPress(); }} style={[styles.checkButton, disabled && styles.sendButtonDisabled]}>
      <Text style={styles.checkButtonText}>Check answers</Text>
    </Pressable>
  );
}

function AssistantMessageContent({ content, onSubmitQuizResults }: { content: string; onSubmitQuizResults: (summary: string) => void }) {
  const quiz = maybeParseQuickQuiz(content);
  if (quiz) return <QuickQuizCard quiz={quiz} onSubmitResults={onSubmitQuizResults} />;
  return <MarkdownText value={content} />;
}

function MarkdownText({ value }: { value: string }) {
  const blocks = value.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <View style={styles.markdown}>
      {blocks.map((block, index) => {
        if (/^#{1,3}\s+/.test(block)) {
          return <Text key={index} style={styles.mdHeading}>{block.replace(/^#{1,3}\s+/, "")}</Text>;
        }
        if (/^[-*]\s+/m.test(block)) {
          return (
            <View key={index} style={styles.mdList}>
              {block.split(/\n/).map((line, lineIndex) => (
                <Text key={`${line}-${lineIndex}`} style={styles.mdListItem}>• {line.replace(/^[-*]\s+/, "")}</Text>
              ))}
            </View>
          );
        }
        return <Text key={index} style={styles.assistantText}>{block.replace(/\*\*/g, "")}</Text>;
      })}
    </View>
  );
}

function QuickQuizCard({ quiz, onSubmitResults }: { quiz: NonNullable<ReturnType<typeof maybeParseQuickQuiz>>; onSubmitResults: (summary: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState(false);
  const correctCount = quiz.questions.filter((question, index) => isCorrect(question, answers[index] || "")).length;
  function checkAnswers() {
    if (checked) return;
    animateNextLayout();
    setChecked(true);
    const userAnswers = quiz.questions.map((_, index) => `${index + 1}. ${(answers[index] || "").trim() || "(blank)"}`);
    onSubmitResults(["Quiz answers submitted. Briefly review only if needed.", `Score: ${correctCount}/${quiz.questions.length}`, "Answers:", ...userAnswers].join("\n\n"));
  }
  return (
    <View style={styles.quizCard}>
      <View style={styles.quizHeader}>
        <Text style={styles.quizTitle}>{quiz.title || "Quick quiz"}</Text>
        <Text style={styles.quizScore}>{checked ? `${correctCount}/${quiz.questions.length}` : `${Object.keys(answers).length}/${quiz.questions.length}`}</Text>
      </View>
      {quiz.instructions ? <Text style={styles.quizInstructions}>{quiz.instructions}</Text> : null}
      {quiz.questions.map((question, index) => {
        const value = answers[index] || "";
        const correct = checked && isCorrect(question, value);
        return (
          <View key={`${question.prompt}-${index}`} style={styles.quizQuestion}>
            <Text style={styles.quizPrompt}>{index + 1}. {question.prompt}</Text>
            {question.choices?.length ? (
              <View style={styles.choices}>
                {question.choices.map((choice) => {
                  const selected = normalizeAnswer(choice) === normalizeAnswer(value);
                  return (
                    <Pressable key={choice} onPress={() => { setAnswers((current) => ({ ...current, [index]: choice })); setChecked(false); }} style={[styles.choice, selected && styles.choiceSelected]}>
                      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{choice}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput autoCapitalize="none" onChangeText={(next) => { setAnswers((current) => ({ ...current, [index]: next })); setChecked(false); }} placeholder="Your answer" style={styles.answerInput} value={value} />
            )}
            {checked ? <Text style={[styles.feedback, correct ? styles.feedbackCorrect : styles.feedbackWrong]}>{correct ? "Correct" : `Answer: ${question.answer}`}</Text> : null}
          </View>
        );
      })}
      <Pressable onPress={checkAnswers} style={styles.checkButton}>
        <Text style={styles.checkButtonText}>Check answers</Text>
      </Pressable>
    </View>
  );
}

function TypingDots() {
  return <View style={styles.typingDots}><View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} /></View>;
}

function isCorrect(question: NonNullable<ReturnType<typeof maybeParseQuickQuiz>>["questions"][number], value: string) {
  const accepted = [question.answer, ...(question.accepted || [])].map(normalizeAnswer);
  return accepted.includes(normalizeAnswer(value));
}

function isLikelyStructuredQuiz(value: string) {
  const trimmed = value.trimStart();
  return trimmed.startsWith("{") && trimmed.includes('"type"') && trimmed.includes("quick_quiz");
}

function practicePrompt(mode: Exclude<AgentMode, "assistant">, format?: ReadingFormat) {
  if (mode === "drills") return "Generate 3 TOEIC-style drills from my current vocabulary set.";
  if (mode === "reading") return `Generate one TOEIC ${format === "part6" ? "Part 6" : "Part 7"} reading practice set from my current vocabulary set.`;
  if (mode === "speaking") return "Generate a speaking and shadowing practice task using my vocabulary set.";
  return "Generate an article practice task using my vocabulary set.";
}

function drillKindLabel(kind: ChallengeDrill["kind"]) {
  if (kind === "rescue") return "Context Rescue";
  if (kind === "collocation") return "Collocation";
  if (kind === "error_spotting") return "Error Spotting";
  if (kind === "trap") return "TOEIC Trap";
  if (kind === "reverse") return "Reverse Dictionary";
  if (kind === "part2_response") return "Part 2 Response";
  return "Micro-Scenario";
}

function drillChoiceLabel(index: number) {
  return ["A", "B", "C", "D"][index] || String(index + 1);
}

function readingAnswerKey(question: ReadingQuestion, index: number) {
  return question.blank ?? index + 1;
}

function documentTypeLabel(value: ReadingDocumentType | ArticlePractice["documentType"]) {
  if (value === "email") return "Email";
  if (value === "notice") return "Notice";
  if (value === "memo") return "Memo";
  if (value === "message") return "Message";
  return "Article";
}

function formatReadingLine(line: string, format: ReadingFormat) {
  return format === "part6" ? line.replace(/\[(\d+)\]\s*_{2,}/g, "[$1] _____") : line;
}

function extractRecentQuizAnswers(messages: ChatMessage[], limit = 16) {
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

function defaultSuggestions(contextDescription: string, count: number) {
  const suffix = count ? ` from ${contextDescription}` : "";
  return [`Quiz me quickly${suffix}.`, `Find confusing words${suffix}.`, `Make a review plan${suffix}.`];
}

function parseCachedMessages(value: string | null) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((message) => message?.role && typeof message.content === "string").slice(-30) : [];
  } catch {
    return [];
  }
}

function parseCachedSuggestions(value: string | null, contextDescription: string, count: number) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed) && parsed.length) return normalizeSuggestions(parsed, contextDescription, count);
  } catch {
    /* fall through */
  }
  return defaultSuggestions(contextDescription, count);
}

function parseSuggestionText(value: string) {
  try {
    const parsed = JSON.parse(value.trim());
    if (Array.isArray(parsed?.suggestions)) return parsed.suggestions.map((item: unknown) => String(item));
  } catch {
    /* fall through */
  }
  return value.split(/\r?\n/).map((line) => line.replace(/^[-*\d.]+\s*/, "").trim()).filter(Boolean);
}

function normalizeSuggestions(items: string[], contextDescription: string, count: number) {
  const seen = new Set<string>();
  return items.map(cleanSuggestionText).filter((item) => item.length >= 8 && item.length <= 120).filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3).concat(defaultSuggestions(contextDescription, count)).filter((item, index, all) => all.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index).slice(0, 3);
}

function cleanSuggestionText(value: unknown) {
  return String(value || "").trim().replace(/^["']|["']$/g, "").split(/(?<=[.!?])\s+/).filter((sentence) => !/\b(json|schema|quick_quiz|return only|format)\b/i.test(sentence)).join(" ").trim();
}

function shortSuggestionLabel(value: string) {
  const words = value.replace(/[?!.]+$/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length <= 4 ? words.join(" ") : `${words.slice(0, 4).join(" ")}...`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.panel },
  headerCopy: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  contextRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.panelSoft },
  loadingPill: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 17, paddingHorizontal: spacing.sm, backgroundColor: colors.accentSoft },
  loadingPillText: { color: colors.accentStrong, fontSize: 10, fontWeight: "900" },
  modeTabs: { flexDirection: "row", gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.panel },
  modeTab: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: 999, paddingHorizontal: spacing.xs, backgroundColor: "transparent" },
  modeTabActive: { backgroundColor: colors.accent },
  modeTabText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  modeTabTextActive: { color: "#ffffff" },
  messagesViewport: { flex: 1, backgroundColor: "#f7faf8" },
  messages: { flexGrow: 1, gap: spacing.md, padding: spacing.md, paddingBottom: spacing.lg },
  generateButton: { alignSelf: "flex-start", minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: 14, paddingHorizontal: spacing.md, backgroundColor: colors.accent },
  generateButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  bubbleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bubbleRowUser: { flexDirection: "row-reverse" },
  bubbleRowQuiz: { alignItems: "stretch" },
  avatar: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.accent },
  avatarUser: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  avatarAgent: { backgroundColor: colors.accent },
  avatarText: { color: "#ffffff", fontSize: 10, fontWeight: "900" },
  avatarTextUser: { color: colors.ink },
  bubble: { maxWidth: "84%", borderRadius: 18, padding: spacing.md },
  agentBubble: { borderTopLeftRadius: 6, backgroundColor: colors.panel },
  userBubble: { borderTopRightRadius: 6, backgroundColor: colors.accent },
  quizBubble: { flex: 1, maxWidth: "100%", padding: 0, backgroundColor: "transparent" },
  userText: { color: "#ffffff", fontSize: 14, fontWeight: "700", lineHeight: 21 },
  markdown: { gap: spacing.sm },
  mdHeading: { color: colors.ink, fontSize: 16, fontWeight: "900", lineHeight: 22 },
  mdList: { gap: spacing.xs },
  mdListItem: { color: colors.ink, fontSize: 14, fontWeight: "600", lineHeight: 21 },
  assistantText: { color: colors.ink, fontSize: 14, fontWeight: "600", lineHeight: 21 },
  generatingText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  typingDots: { height: 18, flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  composer: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.panel },
  suggestionList: { flexDirection: "row", gap: spacing.sm, paddingRight: spacing.md },
  suggestionChip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.panelSoft },
  suggestionText: { color: colors.accentStrong, fontSize: 12, fontWeight: "900" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 24, paddingLeft: spacing.md, paddingRight: 5, paddingVertical: 5, backgroundColor: colors.panelSoft },
  input: { minHeight: 38, maxHeight: 104, flex: 1, paddingHorizontal: 0, paddingVertical: spacing.xs, color: colors.ink, fontSize: 14, fontWeight: "700", textAlignVertical: "top" },
  sendButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: colors.accent },
  sendButtonDisabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 13, fontWeight: "800" },
  practicePanel: { flexGrow: 1, gap: spacing.md, padding: spacing.md, paddingBottom: 40 },
  practiceCard: { gap: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: spacing.md, backgroundColor: colors.panel },
  practiceHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  practiceHeaderCopy: { flex: 1, minWidth: 0 },
  practiceTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  practiceDescription: { color: colors.muted, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  practiceResult: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: spacing.md, backgroundColor: colors.panel },
  drillRoot: { flex: 1, backgroundColor: "#f7faf8" },
  drillPanel: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.lg },
  drillToolbar: { marginHorizontal: -spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.panel },
  drillToolbarText: { color: colors.muted, fontSize: 11, fontWeight: "800", lineHeight: 15 },
  drillActionBar: { borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, backgroundColor: colors.panel },
  drillActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  compactButton: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  drillNavButton: { flex: 1, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  drillResetButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 19, backgroundColor: colors.panelSoft },
  fullWidthGenerateButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 999, paddingHorizontal: spacing.md, backgroundColor: colors.accent },
  compactButtonPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
  compactButtonText: { color: colors.accentStrong, fontSize: 12, fontWeight: "900" },
  compactButtonTextPrimary: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  drillCard: { gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: spacing.md, backgroundColor: colors.panel },
  drillTypeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  drillKind: { overflow: "hidden", borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.accentSoft, color: colors.accentStrong, fontSize: 11, fontWeight: "900" },
  drillMeta: { color: colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  drillTitle: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  drillInstruction: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 19 },
  drillScenario: { color: colors.ink, fontSize: 15, fontWeight: "800", lineHeight: 22 },
  audioTextRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  audioText: { flex: 1, minWidth: 0 },
  drillChoices: { gap: spacing.xs },
  drillChoice: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  drillChoiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  drillChoiceCorrect: { borderColor: colors.accent, backgroundColor: "#eefaf3" },
  drillChoiceWrong: { borderColor: colors.danger, backgroundColor: "#fff2f2" },
  drillChoiceLabel: { width: 24, height: 24, overflow: "hidden", borderRadius: 12, backgroundColor: colors.panel, color: colors.muted, fontSize: 12, fontWeight: "900", lineHeight: 24, textAlign: "center" },
  drillChoiceLabelActive: { backgroundColor: colors.accent, color: "#ffffff" },
  drillChoiceText: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  drillChoiceTextSelected: { color: colors.accentStrong, fontWeight: "900" },
  drillChoiceTextCorrect: { color: colors.accentStrong, fontWeight: "900" },
  drillChoiceTextWrong: { color: colors.danger, fontWeight: "900" },
  drillFeedback: { gap: spacing.xs, borderRadius: 14, padding: spacing.sm },
  drillFeedbackCorrect: { backgroundColor: "#eefaf3" },
  drillFeedbackWrong: { backgroundColor: "#fff2f2" },
  drillFeedbackTitle: { fontSize: 13, fontWeight: "900" },
  drillFeedbackText: { color: colors.ink, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  readingCard: { gap: spacing.sm },
  readingHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: spacing.md, backgroundColor: colors.panel, shadowColor: "#0f172a", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  readingEyebrow: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  readingTitle: { color: colors.ink, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  readingPassagePager: { overflow: "hidden", borderRadius: 8 },
  readingPassage: { gap: spacing.sm, borderWidth: 1, borderColor: "#cdbfaa", borderRadius: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: "#efe6d6", shadowColor: "#2d2416", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 1 },
  readingPassageHeader: { minHeight: 32, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.xs },
  passageLine: { color: "#2a241c", fontSize: 15, fontWeight: "500", lineHeight: 26 },
  documentTabs: { flexDirection: "row", justifyContent: "flex-end", gap: 5 },
  documentTab: { minWidth: 28, height: 28, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#b9c6c0", borderRadius: 6, paddingHorizontal: 7, backgroundColor: colors.panel },
  documentTabActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  documentTabText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  documentTabTextActive: { color: colors.accentStrong },
  documentLabel: { color: "#706453", fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  readingQuestions: { gap: spacing.sm },
  readingQuestion: { gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: spacing.sm, backgroundColor: colors.panelSoft },
  readingQuestionCorrect: { borderColor: colors.accent, backgroundColor: "#eefaf3" },
  readingQuestionWrong: { borderColor: colors.danger, backgroundColor: "#fff2f2" },
  readingQuestionPrompt: { color: colors.ink, fontSize: 13, fontWeight: "900", lineHeight: 19 },
  readingFeedback: { fontSize: 12, fontWeight: "800", lineHeight: 18 },
  readingSectionTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  vocabNotes: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: spacing.sm, backgroundColor: colors.panelSoft },
  vocabNote: { gap: 2, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.xs },
  vocabWord: { color: colors.accentStrong, fontSize: 13, fontWeight: "900" },
  vocabMeaning: { color: colors.ink, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  quizCard: { width: "100%", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: spacing.sm, backgroundColor: colors.panel },
  quizHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  quizTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "900" },
  quizScore: { overflow: "hidden", borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.accent, color: "#ffffff", fontSize: 11, fontWeight: "900" },
  quizInstructions: { color: colors.muted, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  quizQuestion: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: spacing.sm, backgroundColor: colors.panelSoft },
  quizPrompt: { color: colors.ink, fontSize: 13, fontWeight: "800", lineHeight: 19 },
  choices: { gap: spacing.xs },
  choice: { borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: colors.panel },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  choiceText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  choiceTextSelected: { color: colors.accentStrong, fontWeight: "900" },
  answerInput: { minHeight: 40, borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: spacing.md, backgroundColor: colors.panel, color: colors.ink, fontSize: 13, fontWeight: "700" },
  feedback: { fontSize: 12, fontWeight: "800" },
  feedbackCorrect: { color: colors.accentStrong },
  feedbackWrong: { color: colors.danger },
  checkButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: colors.accent },
  checkButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  speakingRoot: { gap: spacing.md, paddingVertical: spacing.xs },
  speakingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.sm },
  speakingTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  speakingSub: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  speakingControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: spacing.xs, backgroundColor: colors.panelSoft },
  controlBtn: { flex: 1, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 999, backgroundColor: colors.panel },
  controlBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  controlBtnText: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  controlBtnTextActive: { color: colors.accentStrong, fontWeight: "900" },
  scrollContainer: { minHeight: 250, maxHeight: 400, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: spacing.md, backgroundColor: colors.panel },
  sentenceContainer: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  sentenceActive: { backgroundColor: colors.panelSoft },
  speakingWordWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  wordColumn: { alignItems: "center", marginRight: 8, marginBottom: 8, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 },
  wordColumnActive: { backgroundColor: colors.accentSoft },
  wordText: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  wordTextActive: { color: colors.accentStrong, fontWeight: "900" },
  wordIpa: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },
  wordIpaActive: { color: colors.accentStrong },
  liaisonSymbol: { color: "#16a34a", fontSize: 15, fontWeight: "900", marginLeft: 1 },
  sentenceIpaText: { color: colors.muted, fontSize: 12, fontWeight: "800", fontStyle: "italic", marginTop: 4 },
  linkingNotes: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: spacing.sm, backgroundColor: colors.panelSoft, marginTop: spacing.xs },
  linkingNotesTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  linkingNoteRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, paddingVertical: 2 },
  linkingNoteText: { color: colors.ink, fontSize: 12, fontWeight: "700", flex: 1 },
});
