import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AnimatedAudioWave, ensureTextAudio } from "../../src/audio";
import { loadCachedCards, loadCustomAgentCardIds, saveCustomAgentCardIds, type MobileCard } from "../../src/cards";
import { CompactContextSelector, CompactFormatSelector, applyContextScope } from "../../src/compact-context-selector";
import {
  buildConversationPlaybackUnits,
  buildConversationPreloadUnits,
  generateDailyConversation,
  voiceLabel,
  type ConversationFormatOption,
  type DailyConversation,
} from "../../src/conversation";
import { recordPracticeAttempt, type ContextScope } from "../../src/practice";
import { buildContextScope } from "../../src/streaming-ui";
import { useListeningPlayer } from "../../src/listening-player";
import { colors, spacing } from "../../src/theme";
import { BodyText, Card, SectionTitle } from "../../src/ui";

type ScopeType = ContextScope["type"];

const formatOptions: Array<{ value: ConversationFormatOption; label: string }> = [
  { value: "auto", label: "All" },
  { value: "conversation", label: "Conversation" },
  { value: "radio", label: "Radio" },
  { value: "announcement", label: "Announce" },
  { value: "story", label: "Story" },
];

export default function ConversationScreen() {
  const insets = useSafeAreaInsets();
  const nonStop = useListeningPlayer();
  const nonStopConfigure = nonStop.configure;
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const runRef = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const lineOffsets = useRef<Record<string, number>>({});
  const conversationCardOffset = useRef(0);
  const [conversation, setConversation] = useState<DailyConversation | null>(null);
  const [format, setFormat] = useState<ConversationFormatOption>("auto");
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("new");
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [topics, setTopics] = useState<string[]>([]);
  const [cards, setCards] = useState<MobileCard[]>([]);
  const [customCardIds, setCustomCardIds] = useState<string[]>([]);
  const [activeLineIds, setActiveLineIds] = useState<string[]>([]);
  const [activePlaybackKey, setActivePlaybackKey] = useState("");
  const [generating, setGenerating] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [error, setError] = useState("");
  const [recentSituations, setRecentSituations] = useState<string[]>([]);

  const contextScope = useMemo(
    () => buildContextScope(scopeType, { topic, level, dateFrom, dateTo, cardIds: customCardIds }),
    [scopeType, topic, level, dateFrom, dateTo, customCardIds],
  );
  const contextCards = useMemo(() => applyContextScope(cards, contextScope), [cards, contextScope]);
  const queueParams = useMemo(() => ({ format, contextScope }), [format, contextScope]);
  const displayedConversation = nonStop.enabled ? nonStop.currentItem?.conversation || conversation : conversation;
  const displayedActiveLineIds = nonStop.enabled ? nonStop.activeLineIds : activeLineIds;
  const displayedActivePlaybackKey = nonStop.enabled ? nonStop.activePlaybackKey : activePlaybackKey;
  const displayedPlaying = nonStop.enabled ? nonStop.playing : status.playing || playingAll;
  const displayedPreparing = nonStop.enabled ? nonStop.preparing : playbackLoading;
  const displayedGenerating = generating || (nonStop.enabled && nonStop.generating && !displayedConversation);
  const displayedError = nonStop.enabled ? nonStop.error || error : error;
  const displayedConversationKey = displayedConversation
    ? `${displayedConversation.title}|${displayedConversation.context || ""}|${displayedConversation.lines.map((line) => line.id).join(",")}`
    : "";

  useFocusEffect(
    useCallback(() => {
      void nonStopConfigure();
    }, [nonStopConfigure]),
  );

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
    const firstActive = displayedActiveLineIds[0];
    if (!firstActive) return;
    const y = lineOffsets.current[firstActive];
    if (typeof y === "number") {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 140), animated: true });
    }
  }, [displayedActiveLineIds]);

  useEffect(() => {
    if (!displayedConversationKey) return;
    lineOffsets.current = {};
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [displayedConversationKey]);

  async function generate() {
    setError("");
    setActiveLineIds([]);
    setActivePlaybackKey("");
    setGenerating(true);
    runRef.current += 1;
    try {
      const next = await generateDailyConversation({ format, contextScope, recentSituations });
      setConversation(next);
      const situation = next.context || next.title;
      setRecentSituations((current) => [situation, ...current.filter((item) => item !== situation)].slice(0, 8));
      await recordPracticeAttempt({
        type: "conversation",
        prompt: `Generate ${format} conversation`,
        response: JSON.stringify(next),
        contextScope,
      });
      void preloadConversationAudio(next);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Cannot generate conversation.");
    } finally {
      setGenerating(false);
    }
  }

  async function preloadConversationAudio(next: DailyConversation) {
    await runWithConcurrency(buildConversationPreloadUnits(next), 2, async (unit) => {
      await ensureTextAudio(unit.text, next.voiceAssignments[unit.speaker]);
    });
  }

  async function playUnit(unit: { ids: string[]; speaker: string; text: string }, runId = runRef.current + 1) {
    const playbackKey = playbackKeyForIds(unit.ids);
    runRef.current = runId;
    player.pause();
    void player.seekTo(0).catch(() => undefined);
    setActiveLineIds(unit.ids);
    setActivePlaybackKey(playbackKey);
    setPlaybackLoading(true);
    setError("");
    try {
      const voiceModel = conversation?.voiceAssignments[unit.speaker];
      const source = await ensureTextAudio(unit.text, voiceModel);
      if (runRef.current !== runId) return;
      player.replace(source);
      player.play();
      setPlaybackLoading(false);
      await waitForPlaybackToFinish(player, unit.text, () => runRef.current === runId);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Cannot play audio.");
    } finally {
      if (runRef.current === runId) {
        setActiveLineIds([]);
        setActivePlaybackKey("");
        setPlaybackLoading(false);
      }
    }
  }

  async function playFullConversation() {
    if (!conversation || playingAll) return;
    const runId = runRef.current + 1;
    runRef.current = runId;
    setPlayingAll(true);
    setError("");
    try {
      for (const unit of buildConversationPlaybackUnits(conversation)) {
        if (runRef.current !== runId) break;
        await playUnit(unit, runId);
      }
    } finally {
      if (runRef.current === runId) {
        setActiveLineIds([]);
        setPlayingAll(false);
      }
    }
  }

  function stopPlayback() {
    runRef.current += 1;
    player.pause();
    void player.seekTo(0).catch(() => undefined);
    setActiveLineIds([]);
    setActivePlaybackKey("");
    setPlaybackLoading(false);
    setPlayingAll(false);
  }

  async function refreshListen() {
    stopPlayback();
    nonStop.stop();
    setError("");
    setConversation(null);
    setActiveLineIds([]);
    setActivePlaybackKey("");
    try {
      const [snapshot, ids] = await Promise.all([loadCachedCards(), loadCustomAgentCardIds()]);
      const nextCards = snapshot?.cards || [];
      const nextTopics = Array.from(new Set(nextCards.map((card) => card.topic).filter(Boolean))).sort();
      setCards(nextCards);
      setTopics(nextTopics.slice(0, 24));
      setCustomCardIds(ids);
    } catch {
      /* ignore */
    }
  }

  return (
    <SafeAreaView edges={[]} style={styles.safeRoot}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerMain}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Listen</Text>
            <View style={styles.contextRow}>
              <Text numberOfLines={1} style={styles.subtitle}>
                {contextCards.length.toLocaleString()} / {cards.length.toLocaleString()} words
              </Text>
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
            <CompactFormatSelector options={formatOptions} value={format} onChange={setFormat} />
          </View>
          {generating ? (
            <View style={styles.loadingPill}>
              <ActivityIndicator color={colors.accentStrong} size="small" />
              <Text style={styles.loadingPillText}>Loading</Text>
            </View>
          ) : (
            <Pressable accessibilityLabel="Refresh" onPress={() => void refreshListen()} style={styles.iconButton}>
              <Ionicons color={colors.ink} name="refresh" size={20} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.body}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.panel} keyboardShouldPersistTaps="handled" style={styles.panelScroll}>
          <View style={styles.toolbar}>
            <Text style={styles.toolbarText}>Structured listening from your vocabulary context—conversation, radio, announcement, or story.</Text>
          </View>
          {displayedError ? <Text style={styles.error}>{displayedError}</Text> : null}
          {displayedConversation ? (
            <ConversationCard
              activeLineIds={displayedActiveLineIds}
              activePlaybackKey={displayedActivePlaybackKey}
              conversation={displayedConversation}
              isPreparing={displayedPreparing}
              isPlaying={displayedPlaying}
              onCardLayout={(y) => {
                conversationCardOffset.current = y;
              }}
              onLineLayout={(id, y) => {
                lineOffsets.current[id] = conversationCardOffset.current + y;
              }}
              onPlayLine={(unit) => void (nonStop.enabled ? nonStop.playLine(unit) : playUnit(unit))}
              onStopPlayback={nonStop.enabled ? nonStop.stop : stopPlayback}
            />
          ) : null}
        </ScrollView>

        <View style={styles.actionBar}>
          {!displayedConversation ? (
            <Pressable
              disabled={displayedGenerating}
              onPress={() => void (nonStop.enabled ? nonStop.generateOne(queueParams) : generate())}
              style={[styles.generateButtonFull, displayedGenerating && styles.generateButtonDisabled]}
            >
              {displayedGenerating ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons color="#ffffff" name="sparkles" size={15} />}
              <Text style={styles.generateButtonTextFull}>{displayedGenerating ? "Preparing..." : "Generate"}</Text>
            </Pressable>
          ) : (
            <View style={styles.actionRow}>
              <Pressable
                disabled={displayedGenerating}
                onPress={() => void (nonStop.enabled ? nonStop.generateOne(queueParams) : generate())}
                style={[styles.actionHalf, styles.actionHalfPrimary, displayedGenerating && styles.generateButtonDisabled]}
              >
                {displayedGenerating ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.actionHalfTextPrimary}>{nonStop.enabled ? "New" : "Regenerate"}</Text>}
              </Pressable>
              <Pressable
                disabled={displayedGenerating}
                onPress={displayedPlaying || displayedPreparing ? (nonStop.enabled ? nonStop.stop : stopPlayback) : () => void (nonStop.enabled ? nonStop.start(queueParams) : playFullConversation())}
                style={[styles.actionHalf, displayedGenerating && styles.generateButtonDisabled]}
              >
                {displayedPreparing ? <ActivityIndicator color={colors.accentStrong} size="small" /> : null}
                <Text style={styles.actionHalfText}>{displayedPreparing ? "Loading" : displayedPlaying ? "Stop" : "Play"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function ConversationCard({
  conversation,
  activeLineIds,
  activePlaybackKey,
  isPreparing,
  isPlaying,
  onCardLayout,
  onLineLayout,
  onPlayLine,
  onStopPlayback,
}: {
  conversation: DailyConversation;
  activeLineIds: string[];
  activePlaybackKey: string;
  isPreparing: boolean;
  isPlaying: boolean;
  onCardLayout: (y: number) => void;
  onLineLayout: (id: string, y: number) => void;
  onPlayLine: (unit: { ids: string[]; speaker: string; text: string }) => void;
  onStopPlayback: () => void;
}) {
  const displayFormat = conversation.format || "conversation";
  const articleFormat = displayFormat === "announcement" || displayFormat === "story";
  const showSpeakerChips = displayFormat === "conversation" || conversation.speakers.length > 1;
  const articleSpeaker = conversation.speakers[0] || conversation.lines[0]?.speaker || "Speaker";
  const articleActive = articleFormat && activeLineIds.some((id) => conversation.lines.some((line) => line.id === id));
  const articleUnit = {
    ids: conversation.lines.map((line) => line.id),
    speaker: articleSpeaker,
    text: conversation.lines.map((line) => line.text).join("\n"),
  };
  const articleKey = playbackKeyForIds(articleUnit.ids);

  return (
    <Card onLayout={(event) => onCardLayout(event.nativeEvent.layout.y)}>
      <View style={styles.conversationHeader}>
        <View style={styles.transcriptHeaderCopy}>
          <SectionTitle>{conversation.title}</SectionTitle>
          {conversation.context ? <BodyText>{conversation.context}</BodyText> : null}
        </View>
        <Text style={styles.formatPill}>{displayFormat}</Text>
      </View>

      {showSpeakerChips ? (
        <View style={styles.speakerRow}>
          {conversation.speakers.map((speaker) => (
            <Text key={speaker} style={styles.speakerChip}>
              {speaker} · {voiceLabel(conversation.voiceAssignments[speaker])}
            </Text>
          ))}
        </View>
      ) : null}

      {articleFormat ? (
        <View style={[styles.articleBlock, articleActive && styles.activeLine]} onLayout={(event) => conversation.lines[0] && onLineLayout(conversation.lines[0].id, event.nativeEvent.layout.y)}>
          <View style={styles.metaRow}>
            <View style={styles.metaCopy}>
              <Text style={styles.speakerName}>{articleSpeaker}</Text>
              <Text style={styles.voiceName}>{voiceLabel(conversation.voiceAssignments[articleSpeaker])}</Text>
            </View>
            <ConversationLineAudioButton
              active={activePlaybackKey === articleKey || articleActive}
              isPreparing={isPreparing}
              isPlaying={isPlaying}
              onPress={activePlaybackKey === articleKey || articleActive ? onStopPlayback : () => onPlayLine(articleUnit)}
            />
          </View>
          {conversation.lines.map((line) => (
            <View key={line.id} style={styles.articleParagraph}>
              <HighlightedText style={styles.lineText} terms={line.vocabulary} text={line.text} />
              {line.translation ? <HighlightedTranslation meanings={line.vocabularyMeanings} text={line.translation} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.lines}>
          {conversation.lines.map((line) => {
            const speakerIndex = Math.max(0, conversation.speakers.indexOf(line.speaker));
            const alignRight = displayFormat === "conversation" && speakerIndex % 2 !== 0;
            const active = activeLineIds.includes(line.id);
            const lineUnit = { ids: [line.id], speaker: line.speaker, text: line.text };
            const lineKey = playbackKeyForIds(lineUnit.ids);
            const linePlaying = activePlaybackKey === lineKey || active;
            return (
              <View
                key={line.id}
                onLayout={(event) => onLineLayout(line.id, event.nativeEvent.layout.y)}
                style={[styles.lineShell, alignRight && styles.lineShellRight]}
              >
                <View style={[styles.avatar, alignRight && styles.avatarRight]}>
                  <Text style={styles.avatarText}>{line.speaker.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={[styles.bubble, alignRight && styles.bubbleRight, active && styles.activeLine]}>
                  <View style={styles.metaRow}>
                    <View style={styles.metaCopy}>
                      <Text style={styles.speakerName}>{line.speaker}</Text>
                      <Text style={styles.voiceName}>{voiceLabel(conversation.voiceAssignments[line.speaker])}</Text>
                    </View>
                    <ConversationLineAudioButton
                      active={linePlaying}
                      isPreparing={isPreparing}
                      isPlaying={isPlaying}
                      onPress={linePlaying ? onStopPlayback : () => onPlayLine(lineUnit)}
                    />
                  </View>
                  <HighlightedText style={styles.lineText} terms={line.vocabulary} text={line.text} />
                  {line.translation ? <HighlightedTranslation meanings={line.vocabularyMeanings} text={line.translation} /> : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function ConversationLineAudioButton({ active, isPreparing, isPlaying, onPress }: { active: boolean; isPreparing: boolean; isPlaying: boolean; onPress: () => void }) {
  const animating = active && isPlaying;
  const loading = active && isPreparing && !isPlaying;

  return (
    <Pressable
      accessibilityLabel={active ? "Stop line audio" : "Play line audio"}
      onPress={onPress}
      style={[styles.lineAudioButton, active && styles.lineAudioButtonActive]}
    >
      {loading ? (
        <ActivityIndicator color={active ? "#ffffff" : colors.accentStrong} size="small" />
      ) : animating ? (
        <AnimatedAudioWave compact />
      ) : (
        <Ionicons color={active ? "#ffffff" : colors.accentStrong} name="volume-high-outline" size={17} />
      )}
    </Pressable>
  );
}

function HighlightedText({ text, terms, style }: { text: string; terms?: string[]; style: object }) {
  const parts = splitByTerms(text, terms || []);
  return (
    <Text style={style}>
      {parts.map((part, index) => (
        <Text key={`${part.text}-${index}`} style={part.highlight ? styles.vocabMark : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function HighlightedTranslation({ text, meanings }: { text: string; meanings?: Record<string, string> }) {
  const parts = splitByTerms(text, Object.values(meanings || {}));
  return (
    <Text style={styles.translation}>
      {parts.map((part, index) => (
        <Text key={`${part.text}-${index}`} style={part.highlight ? styles.translationMark : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function splitByTerms(text: string, terms: string[]): Array<{ text: string; highlight: boolean }> {
  const cleanTerms = terms.map((term) => term.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!cleanTerms.length) return [{ text, highlight: false }];
  const pattern = new RegExp(`(${cleanTerms.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).filter(Boolean).map((part) => ({
    text: part,
    highlight: cleanTerms.some((term) => term.toLowerCase() === part.toLowerCase()),
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function playbackKeyForIds(ids: string[]): string {
  return ids.join("|");
}

async function waitForPlaybackToFinish(
  player: { currentStatus: { currentTime: number; didJustFinish: boolean; duration: number; isLoaded: boolean; playing: boolean } },
  text: string,
  shouldContinue: () => boolean,
): Promise<void> {
  const timeoutAt = Date.now() + playbackGuardMilliseconds(text);
  while (Date.now() < timeoutAt && shouldContinue()) {
    const current = player.currentStatus;
    const nearEnd = current.duration > 0 && current.currentTime >= current.duration - 0.12;
    if (current.didJustFinish || nearEnd) return;
    await delay(120);
  }
}

function playbackGuardMilliseconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(10 * 60 * 1000, Math.max(60 * 1000, words * 900 + 30 * 1000));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      try {
        await worker(item);
      } catch {
        // Preload is best-effort; playback still requests missing audio on demand.
      }
    }
  });
  await Promise.all(workers);
}

const styles = StyleSheet.create({
  safeRoot: { flex: 1, backgroundColor: colors.bg },
  header: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.panel },
  headerMain: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0, gap: 3 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.panelSoft },
  loadingPill: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 17, paddingHorizontal: spacing.sm, backgroundColor: colors.accentSoft },
  loadingPillText: { color: colors.accentStrong, fontSize: 10, fontWeight: "900" },
  title: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  contextRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  body: { flex: 1, backgroundColor: "#f7faf8" },
  panelScroll: { flex: 1 },
  panel: { flexGrow: 1, gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.lg },
  toolbar: { marginHorizontal: -spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.panel },
  toolbarText: { color: colors.muted, fontSize: 11, fontWeight: "800", lineHeight: 15 },
  actionBar: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.panel,
  },
  generateButtonFull: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 999, paddingHorizontal: spacing.md, backgroundColor: colors.accent },
  generateButtonTextFull: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  generateButtonDisabled: { opacity: 0.5 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  actionHalf: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  actionHalfPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
  actionHalfText: { color: colors.accentStrong, fontSize: 12, fontWeight: "900" },
  actionHalfTextPrimary: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  conversationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  transcriptHeaderCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  formatPill: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.accentSoft,
    color: colors.accentStrong,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  speakerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  speakerChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.panelSoft,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  lines: {
    gap: spacing.md,
  },
  lineShell: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  lineShellRight: {
    flexDirection: "row-reverse",
  },
  avatar: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.ink,
  },
  avatarRight: {
    backgroundColor: colors.accent,
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  bubble: {
    flex: 1,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    padding: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  bubbleRight: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 6,
    backgroundColor: "#effaf6",
  },
  articleBlock: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    padding: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  articleParagraph: {
    gap: spacing.xs,
  },
  activeLine: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  metaCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  speakerName: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  voiceName: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  lineAudioButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cfe8df",
    borderRadius: 16,
    backgroundColor: "#ffffff",
  },
  lineAudioButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  lineText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
  },
  translation: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },
  vocabMark: {
    color: colors.accentStrong,
    fontWeight: "900",
    backgroundColor: "#d8f7ed",
  },
  translationMark: {
    color: colors.danger,
    fontWeight: "900",
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
});
