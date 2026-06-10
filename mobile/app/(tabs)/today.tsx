import { Link, useFocusEffect } from "expo-router";
import React from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AddVocaModal } from "../../src/add-voca";
import type { MobileCard } from "../../src/cards";
import { useNetworkState } from "../../src/network";
import { colors, radius, shadows, spacing } from "../../src/theme";
import {
  BodyText,
  Eyebrow,
  LevelBadge,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  StatusPill,
} from "../../src/ui";
import { defaultFilters, useCardsLibrary, useFilteredLibraryCards } from "../../src/useCards";

type LevelKey = "new" | "learning" | "known" | "mastered";

const levelConfig: Record<LevelKey, { label: string; color: string; bg: string }> = {
  new: { label: "New", color: colors.levelNew, bg: colors.levelNewBg },
  learning: { label: "Learning", color: colors.levelLearning, bg: colors.levelLearningBg },
  known: { label: "Known", color: colors.levelKnown, bg: colors.levelKnownBg },
  mastered: { label: "Mastered", color: colors.levelMastered, bg: colors.levelMasteredBg },
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", emoji: "☀️" };
  if (hour < 17) return { text: "Good afternoon", emoji: "🌤️" };
  return { text: "Good evening", emoji: "🌙" };
}

function formatDate() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

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
  const dueCards = React.useMemo(
    () => cards.filter((card) => card.level === "new" || card.level === "learning"),
    [cards],
  );
  const recentCards = React.useMemo(() => cards.slice(0, 3), [cards]);

  return (
    <SafeAreaView edges={[]} style={styles.safeRoot}>
      {/* Page Header */}
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.pageHeaderMain}>
          <View style={styles.pageHeaderCopy}>
            <Text style={styles.pageTitle}>Today</Text>
            <Text style={styles.pageSubtitle}>
              {refreshing
                ? "Syncing library…"
                : `${stats.total} words · ${dueCards.length} due`}
            </Text>
          </View>
          <StatusPill
            label={network.online ? network.label : "Offline"}
            tone={network.online ? "success" : "danger"}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            colors={[colors.accent]}
            onRefresh={() => void reload()}
            refreshing={refreshing}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <GreetingBanner />
        <DashboardHero
          dueCount={dueCards.length}
          onAddVoca={() => setAddVocaOpen(true)}
          stats={stats}
        />
        <RecentCardsPanel cards={recentCards} />
      </ScrollView>

      <AddVocaModal
        onClose={() => setAddVocaOpen(false)}
        onCreated={() => void reload()}
        visible={addVocaOpen}
      />
    </SafeAreaView>
  );
}

// ─── Greeting Banner ─────────────────────────────────────────────────────────

function GreetingBanner() {
  const { text, emoji } = getGreeting();
  return (
    <View style={styles.greetingBanner}>
      <Text style={styles.greetingEmoji}>{emoji}</Text>
      <View style={styles.greetingCopy}>
        <Text style={styles.greetingText}>{text}</Text>
        <Text style={styles.greetingDate}>{formatDate()}</Text>
      </View>
    </View>
  );
}

// ─── Dashboard Hero ───────────────────────────────────────────────────────────

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
      {/* Top row: title + mastery ring */}
      <View style={styles.heroTop}>
        <View style={styles.heroTitleBlock}>
          <Eyebrow>Library</Eyebrow>
          <Text style={styles.heroTitle}>{stats.total}</Text>
          <Text style={styles.heroTitleSub}>words</Text>
          <Text style={styles.heroSubtitle}>
            {dueCount} due · {stats.createdToday} added today
          </Text>
        </View>
        <MasteryRing pct={stats.masteryRate} />
      </View>

      {/* Inline stats */}
      <View style={styles.heroDivider} />
      <View style={styles.heroStats}>
        <InlineStat icon="🗂️" label="Topics" value={stats.topics} />
        <View style={styles.heroStatsDivider} />
        <InlineStat icon="📚" label="Learning" value={stats.levels.learning} />
        <View style={styles.heroStatsDivider} />
        <InlineStat icon="✅" label="Known+" value={stats.levels.known + stats.levels.mastered} />
      </View>

      {/* Actions */}
      <View style={styles.heroActions}>
        <PrimaryButton label="Add Voca" onPress={onAddVoca} style={styles.heroActionBtn} />
        <Link href="/listen" asChild>
          <SecondaryButton label="Listen" style={styles.heroActionBtn} />
        </Link>
      </View>
    </View>
  );
}

// ─── Mastery Ring ─────────────────────────────────────────────────────────────

function MasteryRing({ pct }: { pct: number }) {
  const scaleAnim = React.useRef(new Animated.Value(0.8)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, delay: 200, speed: 6, bounciness: 8 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true, delay: 100 }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  const ringColor = pct >= 70 ? colors.levelMastered : pct >= 40 ? colors.accent : colors.levelLearning;

  return (
    <Animated.View
      style={[
        styles.ringOuter,
        { borderColor: ringColor, transform: [{ scale: scaleAnim }], opacity: opacityAnim },
      ]}
    >
      <View style={[styles.ringInner, { backgroundColor: ringColor + "18" }]}>
        <Text style={[styles.ringNumber, { color: ringColor }]}>{pct}%</Text>
        <Text style={styles.ringLabel}>Mastery</Text>
      </View>
    </Animated.View>
  );
}

// ─── Learning Status Panel ────────────────────────────────────────────────────

function LearningStatusPanel({ stats }: { stats: DashboardStats }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeaderRow}>
        <View style={styles.panelHeaderCopy}>
          <SectionTitle>Learning status</SectionTitle>
          <BodyText>Words by level in your library.</BodyText>
        </View>
        <View style={[styles.masteryBadge, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.masteryBadgeText, { color: colors.accentStrong }]}>
            {stats.masteryRate}%
          </Text>
        </View>
      </View>
      <View style={styles.levelList}>
        {(Object.keys(levelConfig) as LevelKey[]).map((level) => {
          const pct = stats.total ? (stats.levels[level] / stats.total) * 100 : 0;
          const { label, color, bg } = levelConfig[level];
          return <LevelRow key={level} bg={bg} color={color} count={stats.levels[level]} label={label} pct={pct} />;
        })}
      </View>
    </View>
  );
}

function LevelRow({
  label,
  count,
  pct,
  color,
  bg,
}: {
  label: string;
  count: number;
  pct: number;
  color: string;
  bg: string;
}) {
  const widthAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct,
      duration: 800,
      useNativeDriver: false,
      delay: 300,
    }).start();
  }, [pct, widthAnim]);

  const animatedWidth = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
    extrapolate: "clamp",
  });

  return (
    <View style={styles.levelRow}>
      <View style={styles.levelRowTop}>
        <View style={styles.levelRowLabel}>
          <View style={[styles.levelDot, { backgroundColor: color }]} />
          <Text style={styles.levelLabel}>{label}</Text>
        </View>
        <View style={[styles.levelCountBadge, { backgroundColor: bg }]}>
          <Text style={[styles.levelCount, { color }]}>{count}</Text>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { backgroundColor: color, width: animatedWidth }]} />
      </View>
    </View>
  );
}

// ─── Recent Cards Panel ───────────────────────────────────────────────────────

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
            <Text style={styles.linkPillText}>All cards →</Text>
          </Pressable>
        </Link>
      </View>
      {cards.length ? (
        <View style={styles.recentList}>
          {cards.map((card) => (
            <RecentCardItem card={card} key={card.id} />
          ))}
        </View>
      ) : (
        <View style={styles.emptyPlaceholder}>
          <Text style={styles.emptyPlaceholderIcon}>📖</Text>
          <Text style={styles.emptyPlaceholderText}>Add or sync vocabulary to see recent cards here.</Text>
        </View>
      )}
    </View>
  );
}

function RecentCardItem({ card }: { card: MobileCard }) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  function handlePressIn() {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  }
  function handlePressOut() {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start();
  }

  const levelColor =
    card.level === "new"
      ? colors.levelNew
      : card.level === "learning"
        ? colors.levelLearning
        : card.level === "known"
          ? colors.levelKnown
          : colors.levelMastered;

  return (
    <Link href={`/cards/${encodeURIComponent(card.id)}`} asChild>
      <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut}>
        <Animated.View style={[styles.recentCard, { transform: [{ scale: scaleAnim }] }]}>
          <View style={[styles.recentStripe, { backgroundColor: levelColor }]} />
          <View style={styles.recentCardInner}>
            <View style={[styles.recentMark, { backgroundColor: levelColor + "22" }]}>
              <Text style={[styles.recentMarkText, { color: levelColor }]}>
                {card.word.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.recentCopy}>
              <Text numberOfLines={1} style={styles.recentWord}>
                {card.word}
              </Text>
              <Text numberOfLines={1} style={styles.recentMeta}>
                {[card.partOfSpeech, card.topic].filter(Boolean).join(" · ") || "—"}
              </Text>
            </View>
            <LevelBadge level={card.level} />
          </View>
        </Animated.View>
      </Pressable>
    </Link>
  );
}

// ─── Sync Panel ───────────────────────────────────────────────────────────────

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
  const dotTone = error ? colors.danger : offlineReady ? colors.accent : colors.muted;
  const message = refreshing
    ? "Refreshing cards and pending changes…"
    : snapshot
      ? `Cached: ${new Date(snapshot.updatedAt).toLocaleString()}`
      : "No cached cards yet. Open Settings and refresh when online.";

  return (
    <View style={[styles.panel, styles.syncPanel]}>
      <View style={styles.syncRow}>
        <View style={[styles.syncDot, { backgroundColor: dotTone }]} />
        <View style={styles.syncTextBlock}>
          <Text style={styles.syncTitle}>Sync</Text>
          <BodyText>{message}</BodyText>
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function InlineStat({ icon, label, value }: { icon: string; label: string; value: number | string }) {
  return (
    <View style={styles.inlineStat}>
      <Text style={styles.inlineStatIcon}>{icon}</Text>
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeRoot: { flex: 1, backgroundColor: colors.bg },

  // Header
  pageHeader: {
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
    gap: spacing.md,
  },
  pageHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  pageTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 48,
    backgroundColor: colors.bg,
  },

  // Greeting Banner
  greetingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  greetingEmoji: { fontSize: 24 },
  greetingCopy: { flex: 1, gap: 1 },
  greetingText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  greetingDate: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
  },

  // Hero
  heroShell: {
    gap: spacing.md,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.md,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroTitleBlock: { flex: 1, minWidth: 0, gap: 2 },
  heroTitle: {
    color: colors.ink,
    fontSize: 44,
    fontWeight: "900",
    lineHeight: 48,
    letterSpacing: -1,
    marginTop: 4,
  },
  heroTitleSub: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
    marginTop: -4,
  },
  heroSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },

  // Mastery Ring
  ringOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ringInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  ringNumber: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  ringLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 1,
  },

  heroDivider: { height: 1, backgroundColor: colors.lineSoft },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  heroStatsDivider: { width: 1, height: 32, backgroundColor: colors.lineSoft },
  inlineStat: { flex: 1, alignItems: "center", gap: 2 },
  inlineStatIcon: { fontSize: 16 },
  inlineStatValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  inlineStatLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  heroActions: { flexDirection: "row", gap: spacing.sm },
  heroActionBtn: { flex: 1 },

  // Panel
  panel: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    backgroundColor: colors.panel,
    ...shadows.sm,
  },
  panelHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  panelHeaderCopy: { flex: 1, minWidth: 0, gap: 3 },

  masteryBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    flexShrink: 0,
  },
  masteryBadgeText: {
    fontSize: 13,
    fontWeight: "900",
  },

  linkPill: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: colors.panelSoft,
    flexShrink: 0,
  },
  linkPillText: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "800",
  },

  // Level list
  levelList: { gap: spacing.sm },
  levelRow: { gap: 6 },
  levelRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  levelRowLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  levelDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  levelLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  levelCountBadge: {
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexShrink: 0,
  },
  levelCount: {
    fontSize: 12,
    fontWeight: "900",
  },
  progressTrack: {
    height: 7,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: colors.panelSoft,
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    minWidth: 4,
  },

  // Recent cards
  recentList: { gap: spacing.xs },
  recentCard: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.panelSoft,
    overflow: "hidden",
    ...shadows.sm,
  },
  recentStripe: {
    width: 5,
    flexShrink: 0,
  },
  recentCardInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0,
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
    paddingLeft: spacing.sm,
  },
  recentMark: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    flexShrink: 0,
  },
  recentMarkText: {
    fontSize: 15,
    fontWeight: "900",
  },
  recentCopy: { flex: 1, minWidth: 0 },
  recentWord: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  recentMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },

  // Empty placeholder
  emptyPlaceholder: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyPlaceholderIcon: { fontSize: 36 },
  emptyPlaceholderText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 21,
  },

  // Sync
  syncPanel: {
    backgroundColor: colors.panelSoft,
    borderStyle: "dashed",
  },
  syncRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  syncDot: {
    width: 8,
    height: 8,
    marginTop: 7,
    borderRadius: 4,
    flexShrink: 0,
  },
  syncTextBlock: { flex: 1, minWidth: 0, gap: 3 },
  syncTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
});
