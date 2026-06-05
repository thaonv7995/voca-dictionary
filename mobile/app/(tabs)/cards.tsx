import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { uniqueSortedValues, type CreatedDateFilter } from "@voca/core/data/search";
import { AudioIconButton } from "../../src/audio";
import { type MobileCard } from "../../src/cards";
import { useNetworkState } from "../../src/network";
import { colors, spacing } from "../../src/theme";
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
  const topics = useMemo(() => uniqueSortedValues(snapshot?.cards || [], "topic").slice(0, 8), [snapshot?.cards]);
  const topicOptions = useMemo(() => [allTopicOption, ...topics.map((topic) => ({ value: topic, label: topic }))], [topics]);
  const levelOptions = useMemo(() => levels.map((level) => ({ value: level, label: level === "all" ? "All levels" : level })), []);
  const visibleCards = useMemo(
    () => (levelFilter === "all" ? cards : cards.filter((card) => card.level === levelFilter)),
    [cards, levelFilter],
  );

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
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.pageHeaderMain}>
          <View style={styles.pageHeaderCopy}>
            <Text style={styles.pageTitle}>Cards</Text>
            <Text style={styles.pageSubtitle}>
              {visibleCards.length} visible · {snapshot?.cards.length || 0} total
            </Text>
          </View>
          <StatusPill label={network.online ? network.label : "Offline"} tone={network.online ? "success" : "danger"} />
        </View>
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.screen}
        data={visibleCards}
        keyExtractor={(card) => card.id}
        ListHeaderComponent={
          <>
            <View style={styles.filterShell}>
              <View style={styles.searchRow}>
                <Text style={styles.searchIcon}>⌕</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(query) => setFilters({ ...filters, query })}
                  placeholder="Search…"
                  placeholderTextColor={colors.muted}
                  style={styles.search}
                  value={filters.query}
                />
              </View>
              <View style={styles.filterToolbar}>
                <FilterPopup
                  label="Topic"
                  options={topicOptions}
                  value={filters.topic}
                  onChange={(topic) => setFilters({ ...filters, topic })}
                />
                <FilterPopup label="Level" options={levelOptions} value={levelFilter} onChange={setLevelFilter} />
                <FilterPopup
                  label="Date"
                  options={dateFilters}
                  value={filters.createdDate}
                  onChange={(createdDate) => setFilters(setCreatedDateFilter(filters, createdDate))}
                />
              </View>
              <View style={styles.filterActions}>
                <Pressable disabled={refreshing} onPress={() => void reload()} style={[styles.filterBtnPrimary, refreshing && styles.filterBtnDisabled]}>
                  {refreshing ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.filterBtnPrimaryText}>Refresh</Text>}
                </Pressable>
                <Pressable onPress={clearFilters} style={styles.filterBtnGhost}>
                  <Text style={styles.filterBtnGhostText}>Clear</Text>
                </Pressable>
              </View>
              {!network.online && offlineReady ? <Text style={styles.filterNote}>Offline — cached cards</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
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
    </SafeAreaView>
  );
}

function CardRow({ card }: { card: MobileCard }) {
  const hasPos = Boolean(card.partOfSpeech?.trim());
  const hasTopic = Boolean(card.topic?.trim());
  return (
    <Pressable
      onPress={() => router.push(`/cards/${encodeURIComponent(card.id)}`)}
      style={({ pressed }) => [styles.cardRow, pressed && styles.cardRowPressed]}
    >
      <View style={[styles.cardStripe, styles[`cardStripe_${card.level}`]]} />
      <View style={styles.cardMain}>
        <View style={styles.cardHeaderRow}>
          <Text numberOfLines={1} style={styles.word}>{card.word}</Text>
          <Text style={[styles.levelPill, styles[`levelPill_${card.level}`], styles.levelPillNoShrink]}>{card.level}</Text>
        </View>
        {(hasPos || hasTopic) ? (
          <View style={styles.cardMeta}>
            {hasPos ? <Text numberOfLines={1} style={styles.posPill}>{card.partOfSpeech}</Text> : null}
            {hasPos && hasTopic ? <Text style={styles.metaSep}>·</Text> : null}
            {hasTopic ? <Text numberOfLines={1} style={styles.topic}>{card.topic}</Text> : null}
          </View>
        ) : null}
        {card.tags.length ? (
          <Text numberOfLines={1} style={styles.tagLine}>{card.tags.slice(0, 4).join(" · ")}</Text>
        ) : null}
      </View>
      <View style={styles.cardActions}>
        <AudioIconButton card={card} showError={false} />
      </View>
    </Pressable>
  );
}
function FilterPopup<T extends string>({
  label,
  options,
  style,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  style?: ViewStyle;
  value: T;
  onChange: (value: T) => void;
}) {
  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const selected = options.find((option) => option.value === value);

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
    <View style={[styles.dropdownWrap, style]}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <Pressable onPress={() => setVisible(true)} style={styles.dropdownButton}>
        <Text numberOfLines={1} style={styles.dropdownValue}>{selected?.label || "All"}</Text>
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
                <Text style={styles.popupCloseText}>Close</Text>
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
                  {value === option.value ? <Text style={styles.popupCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safeRoot: { flex: 1, backgroundColor: colors.bg },
  pageHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.panel,
  },
  pageHeaderMain: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  pageHeaderCopy: { flex: 1, minWidth: 0, gap: 3 },
  pageTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  pageSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  list: { flex: 1 },
  screen: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 40,
    backgroundColor: colors.bg,
  },
  filterShell: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.sm,
    backgroundColor: colors.panel,
  },
  searchRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.panelSoft,
  },
  searchIcon: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "900",
  },
  search: {
    flex: 1,
    minHeight: 40,
    paddingVertical: 0,
    paddingHorizontal: spacing.xs,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  filterToolbar: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  dropdownWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  dropdownLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  dropdownButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.panelSoft,
  },
  dropdownValue: {
    flex: 1,
    textAlign: "center",
    color: colors.ink,
    fontSize: 11,
    fontWeight: "800",
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
  filterActions: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 2,
  },
  filterBtnPrimary: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
  },
  filterBtnPrimaryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  filterBtnGhost: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    paddingHorizontal: spacing.sm,
  },
  filterBtnGhostText: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: "900",
  },
  filterBtnDisabled: {
    opacity: 0.55,
  },
  filterNote: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
  },
  note: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  cardRow: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    width: "100%",
    maxWidth: "100%",
    gap: 0,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    paddingLeft: 0,
    backgroundColor: colors.panel,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  cardRowPressed: {
    opacity: 0.92,
    backgroundColor: colors.panelSoft,
  },
  cardStripe: {
    width: 4,
    alignSelf: "stretch",
    marginRight: spacing.sm,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    flexShrink: 0,
    backgroundColor: colors.accent,
  },
  cardStripe_new: {
    backgroundColor: colors.muted,
  },
  cardStripe_learning: {
    backgroundColor: "#d97706",
  },
  cardStripe_known: {
    backgroundColor: colors.accentStrong,
  },
  cardStripe_mastered: {
    backgroundColor: "#16a34a",
  },
  cardMain: {
    flex: 1,
    flexShrink: 1,
    gap: 6,
    justifyContent: "center",
    minWidth: 0,
    paddingRight: spacing.xs,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0,
    width: "100%",
  },
  word: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    width: "100%",
  },
  posPill: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.panelSoft,
    color: colors.ink,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  metaSep: {
    flexShrink: 0,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  topic: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  levelPill: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.panelSoft,
    color: colors.accentStrong,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  levelPillNoShrink: {
    flexShrink: 0,
  },
  levelPill_new: {
    color: colors.muted,
  },
  levelPill_learning: {
    backgroundColor: "#fff2d6",
    color: "#9b5d00",
  },
  levelPill_known: {
    backgroundColor: colors.accentSoft,
    color: colors.accentStrong,
  },
  levelPill_mastered: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  tagLine: {
    minWidth: 0,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    flexGrow: 0,
  },
});
