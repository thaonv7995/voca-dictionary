import type { PropsWithChildren, ReactNode } from "react";
import React from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { colors, radius, shadows, spacing } from "./theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type ScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: ReactNode;
}>;

// ─── Screen ───────────────────────────────────────────────────────────────────

export function Screen({ title, subtitle, action, children }: ScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <ScreenHeader action={action} subtitle={subtitle} title={title} />
      {children}
    </ScrollView>
  );
}

export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "danger" | "warning";
}) {
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (tone !== "success") return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [tone, pulseAnim]);

  const pillStyle = [
    styles.statusPill,
    tone === "success" && styles.statusPillSuccess,
    tone === "danger" && styles.statusPillDanger,
    tone === "warning" && styles.statusPillWarning,
  ];
  const textStyle = [
    styles.statusPillText,
    tone === "success" && styles.statusPillTextSuccess,
    tone === "danger" && styles.statusPillTextDanger,
    tone === "warning" && styles.statusPillTextWarning,
  ];
  const dotStyle = [
    styles.statusDot,
    tone === "success" && styles.statusDotSuccess,
    tone === "danger" && styles.statusDotDanger,
    tone === "warning" && styles.statusDotWarning,
  ];

  return (
    <View style={pillStyle}>
      <Animated.View style={[dotStyle, { opacity: pulseAnim }]} />
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  elevated = false,
  ...viewProps
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; elevated?: boolean }> & ViewProps) {
  return (
    <View {...viewProps} style={[styles.card, elevated && styles.cardElevated, style]}>
      {children}
    </View>
  );
}

// ─── Section Title & Body ─────────────────────────────────────────────────────

export function SectionTitle({ children }: PropsWithChildren) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function BodyText({ children, style }: PropsWithChildren<{ style?: StyleProp<any> }>) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

type ButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
} & Omit<PressableProps, "children">;

export function PrimaryButton({ label, onPress, disabled, style, ...pressableProps }: ButtonProps) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  function handlePressIn() {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start();
  }
  function handlePressOut() {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 40 }).start();
  }

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style as ViewStyle]}>
      <Pressable
        {...pressableProps}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && !disabled && styles.primaryButtonPressed]}
      >
        <Text style={styles.primaryButtonText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function SecondaryButton({ label, onPress, disabled, style, ...pressableProps }: ButtonProps) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  function handlePressIn() {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 40 }).start();
  }
  function handlePressOut() {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 40 }).start();
  }

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style as ViewStyle]}>
      <Pressable
        {...pressableProps}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      >
        <Text style={styles.secondaryButtonText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── IconButton ───────────────────────────────────────────────────────────────

export function IconButton({
  icon,
  onPress,
  size = "md",
  variant = "ghost",
}: {
  icon: ReactNode;
  onPress?: () => void;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "filled" | "outline";
}) {
  const sizeMap = { sm: 32, md: 40, lg: 48 };
  const dim = sizeMap[size];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { width: dim, height: dim, borderRadius: dim / 2 },
        variant === "filled" && styles.iconButtonFilled,
        variant === "outline" && styles.iconButtonOutline,
        pressed && styles.pressed,
      ]}
    >
      {icon}
    </Pressable>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export function Badge({
  label,
  color = "accent",
}: {
  label: string;
  color?: "accent" | "warning" | "success" | "danger" | "neutral";
}) {
  const colorMap = {
    accent: { bg: colors.accentSoft, text: colors.accentStrong },
    warning: { bg: colors.levelLearningBg, text: colors.levelLearning },
    success: { bg: colors.levelMasteredBg, text: colors.levelMastered },
    danger: { bg: colors.dangerSoft, text: colors.danger },
    neutral: { bg: colors.panelSoft, text: colors.muted },
  };
  const { bg, text } = colorMap[color];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: text }]}>{label}</Text>
    </View>
  );
}

// ─── LevelBadge ───────────────────────────────────────────────────────────────

export function LevelBadge({ level }: { level: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    new: { bg: colors.levelNewBg, text: colors.levelNew },
    learning: { bg: colors.levelLearningBg, text: colors.levelLearning },
    known: { bg: colors.levelKnownBg, text: colors.levelKnown },
    mastered: { bg: colors.levelMasteredBg, text: colors.levelMastered },
  };
  const { bg, text } = colorMap[level] ?? { bg: colors.panelSoft, text: colors.muted };
  return (
    <View style={[styles.levelBadge, { backgroundColor: bg }]}>
      <Text style={[styles.levelBadgeText, { color: text }]}>{level}</Text>
    </View>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.emptyState}>
      {icon ? <Text style={styles.emptyIcon}>{icon}</Text> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

// ─── AnimatedPressable ────────────────────────────────────────────────────────

export function AnimatedPressable({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: 40,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  headerCopy: {
    flex: 1,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34,
  },
  eyebrow: {
    color: colors.accentStrong,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  card: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.xl,
    padding: spacing.lg,
    backgroundColor: colors.panel,
  },
  cardElevated: {
    borderColor: "transparent",
    ...shadows.md,
  },
  // StatusPill
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.panelSoft,
  },
  statusPillSuccess: {
    borderColor: colors.accentMid,
    backgroundColor: colors.accentSoft,
  },
  statusPillDanger: {
    borderColor: "#f8b4b0",
    backgroundColor: colors.dangerSoft,
  },
  statusPillWarning: {
    borderColor: "#fcd34d",
    backgroundColor: colors.warningSoft,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  statusDotSuccess: { backgroundColor: colors.accent },
  statusDotDanger: { backgroundColor: colors.danger },
  statusDotWarning: { backgroundColor: colors.warning },
  statusPillText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  statusPillTextSuccess: { color: colors.accentStrong },
  statusPillTextDanger: { color: colors.danger },
  statusPillTextWarning: { color: colors.warning },
  // Section
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "500",
  },
  // Buttons
  primaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    ...shadows.sm,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentStrong,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  secondaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.panelSoft,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.accentStrong,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.75,
  },
  // IconButton
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  iconButtonFilled: {
    backgroundColor: colors.accentSoft,
  },
  iconButtonOutline: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
  },
  // Badge
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  // LevelBadge
  levelBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  levelBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.lineSoft,
  },
  // EmptyState
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    fontWeight: "500",
  },
});
