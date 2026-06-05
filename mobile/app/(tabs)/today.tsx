import { Link, useFocusEffect } from "expo-router";
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AddVocaModal } from "../../src/add-voca";
import type { MobileCard } from "../../src/cards";
import { useNetworkState } from "../../src/network";
import { colors, spacing } from "../../src/theme";
import { BodyText, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from "../../src/ui";
import { defaultFilters, useCardsLibrary, useFilteredLibraryCards } from "../../src/useCards";

type LevelKey = "new" | "learning" | "known" | "mastered";

const levelLabels: Record<LevelKey, string> = {
  new: "New",
  learning: "Learning",
  known: "Known",
  mastered: "Mastered",
};

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const { snapshot, refreshing, error, offlineReady, reload, hydrateFromCache } = useCardsLibrary();
  const cards = useFilteredLibraryCards(defaultFilters);
  const [addVocaOpen, setAddVocaOpen] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      void hydrateFromCache();
    }, [hydrateFromCache]),
  );

  const stats = React.useMemo(() => buildDashboardStats(cards), [cards]);
  const dueCards = React.useMemo(() => cards.filter((card) => card.level === "new" || card.level === "learning"), [cards]);
  const recentCards = React.useMemo(() => cards.slice(0, 5), [cards]);

  return (
    <SafeAreaView edges={[]} style={styles.safeRoot}>
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.pageHeaderMain}>
          <View style={styles.pageHeaderCopy}>
            <Text style={styles.pageTitle}>Today</Text>
            <Text style={styles.pageSubtitle}>
              {refreshing
                ? "Syncing library…"
                : error
                  ? "Sync issue — see below"
                  : `${stats.total} words · ${dueCards.length} due`}
            </Text>
          </View>
          <StatusPill label={network.online ? network.label : "Offline"} tone={network.online ? "success" : "danger"} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl colors={[colors.accent]} onRefresh={() => void reload()} refreshing={refreshing} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <DashboardHero dueCount={dueCards.length} onAddVoca={() => setAddVocaOpen(true)} stats={stats} />
        <LearningStatusPanel stats={stats} />
        <RecentCardsPanel cards={recentCards} />
        <SyncPanelCard error={error} offlineReady={offlineReady} refreshing={refreshing} snapshot={snapshot} />
      </ScrollView>
      <AddVocaModal onClose={() => setAddVocaOpen(false)} onCreated={() => void reload()} visible={addVocaOpen} />
    </SafeAreaView>
  );
}

function DashboardHero({
  stats,
  dueCount,
  onAddVoca,
}: {
  stats: DashboardStats;
  dueCount: number;
  onAddVoca: () => void;
}) {
  return (
    <View style={styles.heroShell}>
      <View style={styles.heroTop}>
        <View style={styles.heroTitleBlock}>
          <Text style={styles.heroEyebrow}>Library</Text>
          <Text style={styles.heroTitle}>{stats.total} words</Text>
          <Text style={styles.heroSubtitle}>
            {dueCount} due for review · {stats.createdToday} added today
          </Text>
        </View>
        <View style={styles.ring}>
          <Text style={styles.ringNumber}>{stats.masteryRate}%</Text>
          <Text style={styles.ringLabel}>Mastery</Text>
        </View>
      </View>
      <View style={styles.heroDivider} />
      <View style={styles.heroStats}>
        <InlineStat label="Topics" value={stats.topics} />
        <InlineStat label="Learning" value={stats.levels.learning} />
        <InlineStat label="Known+" value={stats.levels.known + stats.levels.mastered} />
      </View>
      <View style={styles.heroActions}>
        <PrimaryButton label="Add Voca" onPress={onAddVoca} style={styles.heroActionBtn} />
        <Link href="/listen" asChild>
          <SecondaryButton label="Listen" style={styles.heroActionBtn} />
        </Link>
      </View>
    </View>
  );
}

function LearningStatusPanel({ stats }: { stats: DashboardStats }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <View style={styles.panelHeaderCopy}>
          <SectionTitle>Learning status</SectionTitle>
          <BodyText>Words by level in your library.</BodyText>
        </View>
        <Text style={styles.panelBadge}>{stats.masteryRate}%</Text>
      </View>
      <View style={styles.levelList}>
        {(Object.keys(levelLabels) as LevelKey[]).map((level) => {
          const pct = stats.total ? (stats.levels[level] / stats.total) * 100 : 0;
          return (
            <View key={level} style={styles.levelRow}>
              <View style={styles.levelRowTop}>
                <View style={styles.levelRowLabel}>
                  <View style={[styles.levelDot, styles[`levelDot_${level}`]]} />
                  <Text style={styles.levelLabel}>{levelLabels[level]}</Text>
                </View>
                <Text style={styles.levelCount}>{stats.levels[level]}</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, styles[`progressFill_${level}`], { width: `${pct}%` }]} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RecentCardsPanel({ cards }: { cards: MobileCard[] }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <View style={styles.panelHeaderCopy}>
          <SectionTitle>Recent cards</SectionTitle>
          <BodyText>Latest items for a quick peek.</BodyText>
        </View>
        <Link href="/(tabs)/cards" asChild>
          <Pressable style={styles.linkPill}>
            <Text style={styles.linkPillText}>All cards</Text>
          </Pressable>
        </Link>
      </View>
      {cards.length ? (
        <View style={styles.recentList}>
          {cards.map((card) => (
            <Link key={card.id} href={`/cards/${encodeURIComponent(card.id)}`} asChild>
              <Pressable style={({ pressed }) => [styles.recentCard, pressed && styles.recentCardPressed]}>
                <View style={[styles.recentStripe, styles[`recentStripe_${card.level}`]]} />
                <View style={styles.recentCardInner}>
                  <View style={styles.recentMark}>
                    <Text style={styles.recentMarkText}>{card.word.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={styles.recentCopy}>
                    <Text numberOfLines={1} style={styles.recentWord}>
                      {card.word}
                    </Text>
                    <Text numberOfLines={1} style={styles.recentMeta}>
                      {[card.partOfSpeech, card.topic].filter(Boolean).join(" · ") || "—"}
                    </Text>
                  </View>
                  <Text style={[styles.recentLevel, styles[`recentLevel_${card.level}`]]}>{card.level}</Text>
                </View>
              </Pressable>
            </Link>
          ))}
        </View>
      ) : (
        <BodyText>Add or sync vocabulary to see recent cards here.</BodyText>
      )}
    </View>
  );
}

function SyncPanelCard({
  refreshing,
  snapshot,
  error,
  offlineReady,
}: {
  refreshing: boolean;
  snapshot: { updatedAt: string } | null;
  error: string;
  offlineReady: boolean;
}) {
  const dotStyle = error ? styles.syncDotDanger : offlineReady ? styles.syncDotReady : styles.syncDotNeutral;
  const message = refreshing
    ? "Refreshing cards and pending changes…"
    : snapshot
      ? `Offline cache from ${new Date(snapshot.updatedAt).toLocaleString()}`
      : "No cached cards yet. Open Settings and refresh when online.";

  return (
    <View style={[styles.panel, styles.syncPanel]}>
      <View style={styles.syncRow}>
        <View style={[styles.syncDot, dotStyle]} />
        <View style={styles.syncTextBlock}>
          <SectionTitle>Sync</SectionTitle>
          <BodyText>{message}</BodyText>
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function InlineStat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.inlineStat}>
      <Text style={styles.inlineStatValue}>{value}</Text>
      <Text style={styles.inlineStatLabel}>{label}</Text>
    </View>
  );
}

type DashboardStats = ReturnType<typeof buildDashboardStats>;

function buildDashboardStats(cards: Array<{ level: string; topic: string; createdAt?: string }>) {
  const today = new Date().toISOString().slice(0, 10);
  const levels: Record<LevelKey, number> = { new: 0, learning: 0, known: 0, mastered: 0 };
  const topics = new Set<string>();
  let createdToday = 0;

  for (const card of cards) {
    if (card.level in levels) levels[card.level as LevelKey] += 1;
    if (card.topic) topics.add(card.topic);
    if (String(card.createdAt || "").startsWith(today)) createdToday += 1;
  }

  return {
    total: cards.length,
    levels,
    topics: topics.size,
    createdToday,
    masteryRate: cards.length ? Math.round(((levels.known + levels.mastered) / cards.length) * 100) : 0,
  };
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
  scroll: { flex: 1 },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 40,
    backgroundColor: colors.bg,
  },

  heroShell: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.panel,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroTitleBlock: { flex: 1, minWidth: 0 },
  heroEyebrow: {
    color: colors.accentStrong,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 38,
    marginTop: 4,
  },
  heroSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  ring: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 6,
    borderColor: colors.accent,
    borderRadius: 38,
    backgroundColor: colors.panelSoft,
    flexShrink: 0,
  },
  ringNumber: {
    color: colors.accentStrong,
    fontSize: 18,
    fontWeight: "900",
  },
  ringLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
  heroDivider: { height: 1, backgroundColor: colors.line },
  heroStats: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  inlineStat: { flex: 1, minWidth: 0 },
  inlineStatValue: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  inlineStatLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
  heroActions: { flexDirection: "row", gap: spacing.sm },
  heroActionBtn: { flex: 1 },

  panel: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.panel,
  },
  panelHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  panelHeaderCopy: { flex: 1, minWidth: 0, gap: 4 },
  panelBadge: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.accentSoft,
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
    flexShrink: 0,
  },
  linkPill: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.panelSoft,
    flexShrink: 0,
  },
  linkPillText: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
  },

  levelList: { gap: spacing.md },
  levelRow: { gap: 6 },
  levelRowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  levelRowLabel: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1, minWidth: 0 },
  levelDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  levelDot_new: { backgroundColor: colors.muted },
  levelDot_learning: { backgroundColor: "#d97706" },
  levelDot_known: { backgroundColor: colors.accentStrong },
  levelDot_mastered: { backgroundColor: "#16a34a" },
  levelLabel: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  levelCount: { color: colors.muted, fontSize: 14, fontWeight: "900" },
  progressTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: colors.panelSoft,
  },
  progressFill: { height: "100%", borderRadius: 999 },
  progressFill_new: { backgroundColor: colors.muted },
  progressFill_learning: { backgroundColor: "#f59e0b" },
  progressFill_known: { backgroundColor: colors.accent },
  progressFill_mastered: { backgroundColor: "#16a34a" },

  recentList: {
    gap: spacing.sm,
  },
  recentCard: {
    flexDirection: "row",
    alignItems: "stretch",
    alignSelf: "stretch",
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.panelSoft,
    overflow: "hidden",
  },
  recentCardPressed: {
    opacity: 0.88,
    backgroundColor: colors.panel,
  },
  recentStripe: {
    width: 4,
    flexShrink: 0,
    backgroundColor: colors.accent,
  },
  recentStripe_new: { backgroundColor: colors.muted },
  recentStripe_learning: { backgroundColor: "#d97706" },
  recentStripe_known: { backgroundColor: colors.accentStrong },
  recentStripe_mastered: { backgroundColor: "#16a34a" },
  recentCardInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0,
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
  },
  recentMark: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    flexShrink: 0,
  },
  recentMarkText: {
    color: colors.accentStrong,
    fontSize: 16,
    fontWeight: "900",
  },
  recentCopy: { flex: 1, minWidth: 0 },
  recentWord: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  recentMeta: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 3 },
  recentLevel: {
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    flexShrink: 0,
    backgroundColor: colors.panelSoft,
    color: colors.muted,
  },
  recentLevel_new: {
    backgroundColor: colors.panelSoft,
    color: colors.muted,
  },
  recentLevel_learning: { backgroundColor: "#fff2d6", color: "#9b5d00" },
  recentLevel_known: { backgroundColor: colors.accentSoft, color: colors.accentStrong },
  recentLevel_mastered: { backgroundColor: "#dcfce7", color: "#166534" },

  syncPanel: { backgroundColor: colors.panelSoft },
  syncRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  syncDot: { width: 10, height: 10, marginTop: 6, borderRadius: 5, flexShrink: 0 },
  syncDotReady: { backgroundColor: colors.accent },
  syncDotDanger: { backgroundColor: colors.danger },
  syncDotNeutral: { backgroundColor: colors.muted },
  syncTextBlock: { flex: 1, minWidth: 0, gap: 4 },
  errorText: { color: colors.danger, fontSize: 13, fontWeight: "800", marginTop: spacing.sm },
});
