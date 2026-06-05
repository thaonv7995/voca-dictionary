import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { colors, spacing } from "./theme";

type ScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  action?: ReactNode;
}>;

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

export function StatusPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "danger" }) {
  return (
    <View style={[styles.statusPill, tone === "success" && styles.statusPillSuccess, tone === "danger" && styles.statusPillDanger]}>
      <Text style={[styles.statusPillText, tone === "success" && styles.statusPillTextSuccess, tone === "danger" && styles.statusPillTextDanger]}>
        {label}
      </Text>
    </View>
  );
}

export function Card({ children, style, ...viewProps }: PropsWithChildren<{ style?: StyleProp<ViewStyle> } & ViewProps>) {
  return (
    <View {...viewProps} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function BodyText({ children }: PropsWithChildren) {
  return <Text style={styles.body}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
  ...pressableProps
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
} & Omit<PressableProps, "children">) {
  return (
    <Pressable
      {...pressableProps}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, style as ViewStyle, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  style,
  ...pressableProps
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
} & Omit<PressableProps, "children">) {
  return (
    <Pressable
      {...pressableProps}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, style as ViewStyle, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

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
    fontWeight: "800",
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 32,
  },
  card: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    padding: spacing.lg,
    backgroundColor: colors.panel,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.panelSoft,
  },
  statusPillSuccess: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  statusPillDanger: {
    borderColor: colors.danger,
    backgroundColor: "#fff1f0",
  },
  statusPillText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  statusPillTextSuccess: {
    color: colors.accentStrong,
  },
  statusPillTextDanger: {
    color: colors.danger,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.panelSoft,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonText: {
    color: colors.accentStrong,
    fontSize: 14,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
  },
});
