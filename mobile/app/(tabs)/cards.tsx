import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { uniqueSortedValues, type CreatedDateFilter } from "@voca/core/data/search";
import { AudioIconButton } from "../../src/audio";
import { type MobileCard } from "../../src/cards";
import { AddVocaModal } from "../../src/add-voca";
import { FlashcardModal } from "../../src/FlashcardModal";
import { useNetworkState } from "../../src/network";
import { colors, radius, shadows, spacing } from "../../src/theme";
import { Card, StatusPill } from "../../src/ui";
import { defaultFilters, setCreatedDateFilter, useCards } from "../../src/useCards";

const levels = ["all", "new", "learning", "known", "mastered"];
const dateFilters: Array<{ value: CreatedDateFilter; label: string }> = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
];
const allTopicOption = { value: "all", label: "All topics" };

export default function CardsScreen() {
  const insets = useSafeAreaInsets();
  const { cards, snapshot, loading, refreshing, error, offlineReady, filters, setFilters, reload, hydrateFromCache } = useCards();
  const network = useNetworkState();
  const [levelFilter, setLevelFilter] = useState("all");
  const [addVocaOpen, setAddVocaOpen] = useState(false);
  const [flashcardOpen, setFlashcardOpen] = useState(false);
  const topics = useMemo(() => uniqueSortedValues(snapshot?.cards || [], "topic").slice(0, 8), [snapshot?.cards]);
  const topicOptions = useMemo(() => [allTopicOption, ...topics.map((topic) => ({ value: topic, label: topic }))], [topics]);
  const levelOptions = useMemo(() => levels.map((level) => ({ value: level, label: level === "all" ? "All levels" : level })), []);
  const visibleCards = useMemo(
    () => (levelFilter === "all" ? cards : cards.filter((card) => card.level === levelFilter)),
    [cards, levelFilter],
  );

  const hasActiveFilters = filters.query || filters.topic !== "all" || levelFilter !== "all" || filters.createdDate !== "all";

  function clearFilters() {
    setFilters(defaultFilters);
    setLevelFilter("all");
  }

  useFocusEffect(
    useCallback(() => {
      void hydrateFromCache();
    }, [hydrateFromCache]),
  );

  return (
    <SafeAreaView edges={[]} style={styles.safeRoot}>
      {/* Sticky header */}
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.pageHeaderMain}>
          <View style={styles.pageHeaderCopy}>
            <Text style={styles.pageTitle}>Cards</Text>
            <Text style={styles.pageSubtitle}>
              {visibleCards.length} visible · {snapshot?.cards.length || 0} total
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              disabled={refreshing}
              onPress={() => void reload()}
              style={[styles.headerIconBtn, refreshing && styles.headerIconBtnDisabled]}
            >
              {refreshing
                ? <ActivityIndicator color={colors.accent} size="small" />
                : <Ionicons name="refresh-outline" size={18} color={colors.accent} />}
            </Pressable>
            <Pressable onPress={() => setFlashcardOpen(true)} style={[styles.headerIconBtn, { marginRight: 8 }]}>
              <Ionicons name="albums-outline" size={18} color={colors.accent} />
            </Pressable>
            <Pressable onPress={() => setAddVocaOpen(true)} style={styles.addBtn}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
        </View>

        {/* Compact search + filter row */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={15} color={colors.muted} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(query) => setFilters({ ...filters, query })}
            placeholder="Search words…"
            placeholderTextColor={colors.mutedLight}
            style={styles.search}
            value={filters.query}
          />
          {filters.query ? (
            <Pressable onPress={() => setFilters({ ...filters, query: "" })} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {/* Horizontal scroll filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChips}
          style={styles.filterChipsScroll}
        >
          <FilterChip
            label={levelFilter === "all" ? "Level" : levelFilter}
            active={levelFilter !== "all"}
            options={levelOptions}
            value={levelFilter}
            onChange={setLevelFilter}
          />
          <FilterChip
            label={filters.topic === "all" ? "Topic" : filters.topic}
            active={filters.topic !== "all"}
            options={topicOptions}
            value={filters.topic}
            onChange={(topic) => setFilters({ ...filters, topic })}
          />
          <FilterChip
            label={filters.createdDate === "all" ? "Date" : dateFilters.find(d => d.value === filters.createdDate)?.label || "Date"}
            active={filters.createdDate !== "all"}
            options={dateFilters}
            value={filters.createdDate}
            onChange={(createdDate) => setFilters(setCreatedDateFilter(filters, createdDate))}
          />
          {hasActiveFilters ? (
            <Pressable onPress={clearFilters} style={styles.clearChip}>
              <Ionicons name="close" size={11} color={colors.danger} />
              <Text style={styles.clearChipText}>Clear</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.screen}
        data={visibleCards}
        keyExtractor={(card) => card.id}
        ListHeaderComponent={
          <>
          {loading && !snapshot ? <ActivityIndicator color={colors.accent} /> : null}
          {!loading && !visibleCards.length ? (
            <Card>
              <Text style={styles.emptyTitle}>{snapshot ? "No matching cards" : "No cards synced"}</Text>
              <Text style={styles.note}>
                {snapshot ? "Try clearing filters or refreshing." : "Configure Settings, then refresh to bootstrap cards from the Voca API."}
              </Text>
            </Card>
          ) : null}
          </>
        }
        renderItem={({ item }) => <CardRow card={item} />}
      />

      <AddVocaModal
        visible={addVocaOpen}
        onClose={() => setAddVocaOpen(false)}
        onCreated={() => void reload()}
      />
      <FlashcardModal
        visible={flashcardOpen}
        cards={visibleCards}
        onClose={() => setFlashcardOpen(false)}
        onLevelChange={(card, level) => {
          // It's handled inside the modal by patchCardLevel, we can just let it reload on blur
        }}
      />
    </SafeAreaView>
  );
}

function CardRow({ card }: { card: MobileCard }) {
  const hasPos = Boolean(card.partOfSpeech?.trim());
  const hasTopic = Boolean(card.topic?.trim());
  const hasMeaningVi = Boolean(card.meaningVi?.trim());
  const hasIpa = Boolean(card.pronunciation?.trim() || card.ipa?.trim());
  const ipa = card.pronunciation || card.ipa || "";
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const levelConfig: Record<string, { stripe: string; dot: string; label: string }> = {
    new:      { stripe: colors.levelNew,      dot: colors.levelNew,      label: "New" },
    learning: { stripe: colors.levelLearning, dot: colors.levelLearning, label: "Learning" },
    known:    { stripe: colors.levelKnown,    dot: colors.levelKnown,    label: "Known" },
    mastered: { stripe: colors.levelMastered, dot: colors.levelMastered, label: "Mastered" },
  };
  const lc = levelConfig[card.level] ?? levelConfig.new;

  return (
    <Pressable
      onPress={() => router.push(`/cards/${encodeURIComponent(card.id)}`)}
      onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
      onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
    >
      <Animated.View style={[styles.cardRow, { transform: [{ scale: scaleAnim }] }]}>
        {/* Level stripe */}
        <View style={[styles.cardStripe, { backgroundColor: lc.stripe }]} />

        <View style={styles.cardMain}>
          {/* Row 1: Word (big) + audio button */}
          <View style={styles.cardTopRow}>
            <Text numberOfLines={1} style={styles.word}>{card.word}</Text>
            <AudioIconButton card={card} showError={false} />
          </View>

          {/* Row 2: Vietnamese meaning */}
          {hasMeaningVi ? (
            <Text numberOfLines={2} style={styles.meaningVi}>{card.meaningVi}</Text>
          ) : null}

          {/* Row 3: All meta in one line — POS · topic · IPA · level */}
          <View style={styles.metaRow}>
            {hasPos ? (
              <Text numberOfLines={1} style={styles.posText}>{card.partOfSpeech}</Text>
            ) : null}
            {hasPos && hasTopic ? <Text style={styles.metaDot}>·</Text> : null}
            {hasTopic ? (
              <Text numberOfLines={1} style={styles.topicText}>{card.topic}</Text>
            ) : null}
            {(hasPos || hasTopic) && hasIpa ? <Text style={styles.metaDot}>·</Text> : null}
            {hasIpa ? (
              <Text numberOfLines={1} style={styles.ipaInline}>/{ipa}/</Text>
            ) : null}
            <View style={styles.metaSpacer} />
            <View style={[styles.levelDot, { backgroundColor: lc.dot }]} />
            <Text style={[styles.levelLabel, { color: lc.dot }]}>{lc.label}</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}
// ─── FilterChip ───────────────────────────────────────────────────────────────

function FilterChip<T extends string>({
  label,
  active,
  options,
  value,
  onChange,
}: {
  label: string;
  active: boolean;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  function close() {
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const sheetTransform = progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={[styles.filterChip, active && styles.filterChipActive]}
      >
        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>{label}</Text>
        <Ionicons
          name="chevron-down"
          size={10}
          color={active ? colors.accentStrong : colors.muted}
        />
      </Pressable>
      <Modal animationType="none" transparent visible={visible} onRequestClose={close}>
        <Animated.View style={[styles.popupBackdrop, { opacity: backdropOpacity }]}>
          <Pressable onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <View pointerEvents="box-none" style={styles.popupLayer}>
          <Animated.View style={[styles.popupSheet, { transform: [{ translateY: sheetTransform }] }]}>
            <View style={styles.popupHandle} />
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>{label}</Text>
              <Pressable onPress={close} style={styles.popupCloseButton}>
                <Ionicons name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.popupOptions}>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    close();
                  }}
                  style={[styles.popupItem, value === option.value && styles.popupItemActive]}
                >
                  <Text style={[styles.popupItemText, value === option.value && styles.popupItemTextActive]}>{option.label}</Text>
                  {value === option.value ? <Ionicons name="checkmark" size={18} color={colors.accentStrong} /> : null}
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

// Legacy alias for compatibility
function FilterPopup<T extends string>(props: Parameters<typeof FilterChip<T>>[0]) {
  return <FilterChip {...props} />;
}

const styles = StyleSheet.create({
  safeRoot: { flex: 1, backgroundColor: colors.bg },

  // ── Header ──────────────────────────────────────────────────────────────
  pageHeader: {
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.panel,
    ...shadows.sm,
  },
  pageHeaderMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pageHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  pageTitle: { color: colors.ink, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  pageSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "600" },

  // Header action buttons
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: colors.panelSoft,
  },
  headerIconBtnDisabled: { opacity: 0.5 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    ...shadows.sm,
  },
  addBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  // ── Search bar ─────────────────────────────────────────────────────────
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 38,
    borderWidth: 1.5,
    borderColor: colors.lineSoft,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  search: {
    flex: 1,
    paddingVertical: 0,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },

  // ── Filter chips ────────────────────────────────────────────────────────
  filterChipsScroll: { marginHorizontal: -spacing.lg },
  filterChips: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
  },
  filterChipActive: {
    borderColor: colors.accentMid,
    backgroundColor: colors.accentSoft,
  },
  filterChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: 80,
  },
  filterChipTextActive: {
    color: colors.accentStrong,
  },
  clearChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "#f8b4b0",
    backgroundColor: colors.dangerSoft,
  },
  clearChipText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "900",
  },

  // ── List ────────────────────────────────────────────────────────────────
  list: { flex: 1 },
  screen: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 40,
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: spacing.xs,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900",
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 19,
  },

  popupBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 20, 17, 0.42)",
  },
  popupLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  popupSheet: {
    maxHeight: "72%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.panel,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  popupHandle: {
    width: 42,
    height: 4,
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: colors.line,
  },
  popupHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  popupTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  popupCloseButton: {
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.panelSoft,
  },
  popupCloseText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  popupOptions: {
    gap: spacing.xs,
  },
  popupItem: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  popupItemActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  popupItemText: {
    flex: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  popupItemTextActive: {
    color: colors.accentStrong,
    fontWeight: "900",
  },
  popupCheck: {
    color: colors.accentStrong,
    fontSize: 18,
    fontWeight: "900",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.panel,
    ...shadows.sm,
  },
  cardStripe: {
    width: 4,
    flexShrink: 0,
  },
  cardMain: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    gap: 3,
  },

  // Row 1: word + audio
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
    minWidth: 0,
  },
  word: {
    flex: 1,
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  // Row 2: Vietnamese meaning
  meaningVi: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  // Row 3: compact meta
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "nowrap",
    marginTop: 1,
  },
  posText: {
    color: colors.mutedLight,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
    flexShrink: 0,
  },
  topicText: {
    color: colors.mutedLight,
    fontSize: 11,
    fontWeight: "500",
    flexShrink: 1,
    minWidth: 0,
  },
  ipaInline: {
    color: colors.mutedLight,
    fontSize: 10,
    fontStyle: "italic",
    flexShrink: 1,
    minWidth: 0,
  },
  metaDot: {
    color: colors.line,
    fontSize: 10,
    flexShrink: 0,
  },
  metaSpacer: { flex: 1 },
  levelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  levelLabel: {
    fontSize: 10,
    fontWeight: "800",
    flexShrink: 0,
    textTransform: "capitalize",
  },

  // Legacy compat
  cardActions: {},
  cardHeaderRow: {},
  cardWordBlock: {},
  ipa: {},
  levelBadge: {},
  levelBadgeText: {},
  cardMeta: {},
  posPill: {},
  metaSep: {},
  topic: {},
  levelPill: {},
  levelPillNoShrink: {},
  levelPill_new: {},
  levelPill_learning: {},
  levelPill_known: {},
  levelPill_mastered: {},
  tagLine: {},
});
