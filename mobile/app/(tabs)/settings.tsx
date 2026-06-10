import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator, Animated, Easing, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { clearAudioCache } from "../../src/audio";
import { clearCardImageCache } from "../../src/cards";
import { clearClientErrors, loadClientErrors, type ClientErrorLog } from "../../src/logging";
import { useNetworkState } from "../../src/network";
import {
  checkApiHealth,
  defaultConversationVoiceB,
  defaultConversationVoiceC,
  defaultTtsModel,
  loadApiSettings,
  loadAudioWifiOnly,
  loadNonStopListeningEnabled,
  loadNonStopPreloadCount,
  saveApiSettings,
  saveAudioWifiOnly,
  saveNonStopListeningEnabled,
  saveNonStopPreloadCount,
  ttsVoiceOptions,
  type ApiSettings,
} from "../../src/settings";
import { flushPendingSync, loadPendingSyncSummary, type PendingSyncSummary } from "../../src/sync";
import { colors, radius, shadows, spacing } from "../../src/theme";
import { StatusPill } from "../../src/ui";

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckState = { status: "idle" | "checking" | "success" | "error"; message: string };

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsTabScreen() {
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const [settings, setSettings] = useState<ApiSettings>({
    baseUrl: "", token: "", llmBaseUrl: "", llmApiKey: "", llmModel: "",
    ttsEndpoint: "", ttsModel: defaultTtsModel,
    conversationVoiceA: defaultTtsModel,
    conversationVoiceB: defaultConversationVoiceB,
    conversationVoiceC: defaultConversationVoiceC,
    conversationAutoSelectVoices: true,
    useApiTts: true,
  });
  const [loading, setLoading] = useState(true);
  const [checkState, setCheckState] = useState<CheckState>({ status: "idle", message: "" });
  const [cacheMessage, setCacheMessage] = useState("");
  const [audioWifiOnly, setAudioWifiOnly] = useState(false);
  const [nonStopEnabled, setNonStopEnabled] = useState(false);
  const [nonStopPreloadCount, setNonStopPreloadCount] = useState(1);
  const [pending, setPending] = useState<PendingSyncSummary>({ levelUpdates: 0, practiceAttempts: 0, total: 0 });
  const [errors, setErrors] = useState<ClientErrorLog[]>([]);

  useEffect(() => {
    Promise.all([
      loadApiSettings(), loadAudioWifiOnly(), loadNonStopListeningEnabled(),
      loadNonStopPreloadCount(), loadPendingSyncSummary(), loadClientErrors(),
    ]).then(([api, wifi, nonStop, preload, pendingSync, errLog]) => {
      setSettings(api);
      setAudioWifiOnly(wifi);
      setNonStopEnabled(nonStop);
      setNonStopPreloadCount(preload);
      setPending(pendingSync);
      setErrors(errLog);
    }).finally(() => setLoading(false));
  }, []);

  async function saveAndCheck() {
    setCheckState({ status: "checking", message: "Checking Voca API…" });
    try {
      await saveApiSettings(settings);
      const message = await checkApiHealth(settings);
      setCheckState({ status: "success", message });
    } catch (error) {
      setCheckState({
        status: "error",
        message: error instanceof Error ? error.message : "Cannot connect to Voca API.",
      });
    }
  }

  const isSaving = checkState.status === "checking";

  if (loading) {
    return (
      <SafeAreaView edges={[]} style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
          <Text style={styles.pageTitle}>Settings</Text>
          <StatusPill label={network.online ? network.label : "Offline"} tone={network.online ? "success" : "danger"} />
        </View>
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={[]} style={styles.root}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.pageTitle}>Settings</Text>
          <Text style={styles.pageSubtitle}>API · Voice · Storage</Text>
        </View>
        <StatusPill label={network.online ? network.label : "Offline"} tone={network.online ? "success" : "danger"} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── SECTION: Voca API ── */}
        <SettingsSection
          icon="cloud-outline"
          iconColor="#3B82F6"
          title="Voca API"
          subtitle="Bridge endpoint & token"
        >
          <InputRow
            label="Base URL"
            placeholder="https://voca-api.example.com"
            keyboardType="url"
            value={settings.baseUrl}
            onChangeText={(baseUrl) => setSettings((s) => ({ ...s, baseUrl }))}
          />
          <InputRow
            label="API Token"
            placeholder="Shared Voca API token"
            secure
            value={settings.token}
            onChangeText={(token) => setSettings((s) => ({ ...s, token }))}
            isLast
          />
          <SaveRow
            isSaving={isSaving}
            checkState={checkState}
            onPress={saveAndCheck}
          />
        </SettingsSection>

        {/* ── SECTION: LLM Provider ── */}
        <SettingsSection
          icon="hardware-chip-outline"
          iconColor="#8B5CF6"
          title="AI Model"
          subtitle="LLM provider for agent & cards"
        >
          <InputRow
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            keyboardType="url"
            value={settings.llmBaseUrl}
            onChangeText={(llmBaseUrl) => setSettings((s) => ({ ...s, llmBaseUrl }))}
          />
          <InputRow
            label="API Key"
            placeholder="sk-…"
            secure
            value={settings.llmApiKey}
            onChangeText={(llmApiKey) => setSettings((s) => ({ ...s, llmApiKey }))}
          />
          <InputRow
            label="Model"
            placeholder="gpt-4.1-mini"
            value={settings.llmModel}
            onChangeText={(llmModel) => setSettings((s) => ({ ...s, llmModel }))}
          />
          <SaveRow
            isSaving={isSaving}
            checkState={checkState}
            onPress={saveAndCheck}
          />
        </SettingsSection>

        {/* ── SECTION: Voice & TTS ── */}
        <SettingsSection
          icon="mic-outline"
          iconColor="#10B981"
          title="Voice & TTS"
          subtitle="Speech synthesis settings"
          headerRight={
            <TogglePill
              active={settings.useApiTts}
              label={settings.useApiTts ? "API TTS" : "Off"}
              onPress={() => setSettings((s) => ({ ...s, useApiTts: !s.useApiTts }))}
            />
          }
        >
          <InputRow
            label="Speech Endpoint"
            placeholder="Optional — defaults to base URL + /audio/speech"
            keyboardType="url"
            value={settings.ttsEndpoint}
            onChangeText={(ttsEndpoint) => setSettings((s) => ({ ...s, ttsEndpoint }))}
          />
          <VoicePickerRow
            label="Voice Model"
            sheetTitle="Voice model"
            value={settings.ttsModel}
            onChange={(ttsModel) => setSettings((s) => ({ ...s, ttsModel }))}
            isLast
          />
        </SettingsSection>

        {/* ── SECTION: Conversation voices ── */}
        <SettingsSection
          icon="people-outline"
          iconColor="#F59E0B"
          title="Conversation Voices"
          subtitle="Speakers A / B / C"
          headerRight={
            <TogglePill
              active={settings.conversationAutoSelectVoices}
              label={settings.conversationAutoSelectVoices ? "Auto" : "Manual"}
              onPress={() => setSettings((s) => ({ ...s, conversationAutoSelectVoices: !s.conversationAutoSelectVoices }))}
            />
          }
        >
          <VoicePickerRow label="Voice A" sheetTitle="Voice A" value={settings.conversationVoiceA} onChange={(v) => setSettings((s) => ({ ...s, conversationVoiceA: v }))} />
          <VoicePickerRow label="Voice B" sheetTitle="Voice B" value={settings.conversationVoiceB} onChange={(v) => setSettings((s) => ({ ...s, conversationVoiceB: v }))} />
          <VoicePickerRow label="Voice C" sheetTitle="Voice C" value={settings.conversationVoiceC} onChange={(v) => setSettings((s) => ({ ...s, conversationVoiceC: v }))} isLast />
        </SettingsSection>

        {/* ── SECTION: Non-stop listening ── */}
        <SettingsSection
          icon="play-circle-outline"
          iconColor="#EF4444"
          title="Non-stop Listening"
          subtitle="Auto-queue TTS audio"
          headerRight={
            <TogglePill
              active={nonStopEnabled}
              label={nonStopEnabled ? "On" : "Off"}
              onPress={() => {
                const next = !nonStopEnabled;
                setNonStopEnabled(next);
                void saveNonStopListeningEnabled(next);
              }}
            />
          }
        >
          <View style={styles.preloadRow}>
            <Text style={styles.preloadLabel}>Preload ahead</Text>
            <View style={styles.segmentRow}>
              {[1, 2, 3].map((count) => (
                <Pressable
                  key={count}
                  onPress={() => { setNonStopPreloadCount(count); void saveNonStopPreloadCount(count); }}
                  style={[styles.segmentBtn, nonStopPreloadCount === count && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentBtnText, nonStopPreloadCount === count && styles.segmentBtnTextActive]}>
                    {count}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </SettingsSection>

        {/* ── SECTION: Offline sync ── */}
        <SettingsSection
          icon="sync-outline"
          iconColor="#06B6D4"
          title="Offline Sync"
          subtitle="Pending changes queue"
        >
          <View style={styles.syncStats}>
            {[
              { label: "Total", value: pending.total },
              { label: "Levels", value: pending.levelUpdates },
              { label: "Practice", value: pending.practiceAttempts },
            ].map((stat) => (
              <View key={stat.label} style={styles.syncStat}>
                <Text style={styles.syncStatValue}>{stat.value}</Text>
                <Text style={styles.syncStatLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
          <ActionRow
            icon="cloud-upload-outline"
            label={pending.total ? "Retry pending sync" : "Nothing pending"}
            disabled={!pending.total || !network.online}
            onPress={async () => { const next = await flushPendingSync(); setPending(next); }}
            hint={!network.online ? "Reconnect to flush the queue" : undefined}
            isLast
          />
        </SettingsSection>

        {/* ── SECTION: Storage ── */}
        <SettingsSection
          icon="folder-outline"
          iconColor="#6B7280"
          title="Storage & Cache"
          subtitle="On-device cached files"
        >
          <ActionRow
            icon="image-outline"
            label="Clear image cache"
            onPress={() => { clearCardImageCache(); setCacheMessage("Image cache cleared."); }}
          />
          <ActionRow
            icon="musical-notes-outline"
            label="Clear audio cache"
            onPress={() => { clearAudioCache(); setCacheMessage("Audio cache cleared."); }}
          />
          <ToggleRow
            icon="wifi-outline"
            label="Audio downloads"
            hint={audioWifiOnly ? "Wi‑Fi only" : "Any network"}
            active={audioWifiOnly}
            onPress={() => {
              const next = !audioWifiOnly;
              setAudioWifiOnly(next);
              void saveAudioWifiOnly(next);
            }}
            isLast
          />
          {cacheMessage ? <Text style={styles.feedbackOk}>{cacheMessage}</Text> : null}
        </SettingsSection>

        {/* ── SECTION: Diagnostics ── */}
        <SettingsSection
          icon="bug-outline"
          iconColor="#9CA3AF"
          title="Diagnostics"
          subtitle={errors.length ? `${errors.length} error entries` : "No errors logged"}
        >
          <ActionRow
            icon="trash-outline"
            label="Clear error logs"
            destructive
            onPress={async () => { await clearClientErrors(); setErrors([]); }}
            isLast
          />
        </SettingsSection>

        <Text style={styles.versionNote}>Voca Mobile · Settings</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── SettingsSection ──────────────────────────────────────────────────────────

function SettingsSection({
  icon, iconColor, title, subtitle, headerRight, children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIconWrap, { backgroundColor: iconColor + "18" }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
        </View>
        {headerRight ?? null}
      </View>
      {/* Section body */}
      <View style={styles.sectionBody}>
        {children}
      </View>
    </View>
  );
}

// ─── InputRow ─────────────────────────────────────────────────────────────────

function InputRow({
  label, placeholder, value, onChangeText, secure, keyboardType, isLast,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  keyboardType?: "url" | "default";
  isLast?: boolean;
}) {
  const [pasted, setPasted] = useState(false);

  async function handlePaste() {
    const text = await Clipboard.getStringAsync();
    if (text) {
      onChangeText(text.trim());
      setPasted(true);
      setTimeout(() => setPasted(false), 1500);
    }
  }

  return (
    <View style={[styles.fieldRow, isLast && styles.fieldRowLast]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType ?? "default"}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedLight}
          secureTextEntry={secure}
          style={styles.inputInner}
          value={value}
        />
        <Pressable onPress={handlePaste} style={styles.pasteIconBtn} hitSlop={8}>
          <Ionicons
            name={pasted ? "checkmark-circle" : "clipboard-outline"}
            size={17}
            color={pasted ? colors.accentStrong : colors.line}
          />
        </Pressable>
      </View>
    </View>
  );
}

// ─── VoicePickerRow ───────────────────────────────────────────────────────────

function VoicePickerRow({
  label, sheetTitle, value, onChange, isLast,
}: {
  label: string;
  sheetTitle: string;
  value: string;
  onChange: (v: string) => void;
  isLast?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const selected = ttsVoiceOptions.find((o) => o.value === value);

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [progress, visible]);

  function close() {
    Animated.timing(progress, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setVisible(false); });
  }

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const sheetY = progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.voiceRow, isLast && styles.fieldRowLast, pressed && styles.rowPressed]}
      >
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.voiceValue}>
          <Text numberOfLines={1} style={styles.voiceValueText}>{selected?.label ?? "Choose…"}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.mutedLight} />
        </View>
      </Pressable>
      <Modal animationType="none" transparent visible={visible} onRequestClose={close}>
        <Animated.View style={[styles.popupBackdrop, { opacity: backdropOpacity }]}>
          <Pressable onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <View pointerEvents="box-none" style={styles.popupLayer}>
          <Animated.View style={[styles.popupSheet, { transform: [{ translateY: sheetY }] }]}>
            <View style={styles.popupHandle} />
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>{sheetTitle}</Text>
              <Pressable onPress={close} style={styles.popupCloseBtn}>
                <Ionicons name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.popupList} showsVerticalScrollIndicator={false}>
              {ttsVoiceOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => { onChange(opt.value); close(); }}
                  style={[styles.popupItem, value === opt.value && styles.popupItemActive]}
                >
                  <Text style={[styles.popupItemText, value === opt.value && styles.popupItemTextActive]}>{opt.label}</Text>
                  {value === opt.value ? <Ionicons name="checkmark" size={18} color={colors.accentStrong} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

// ─── ActionRow ────────────────────────────────────────────────────────────────

function ActionRow({
  icon, label, onPress, disabled, destructive, hint, isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  hint?: string;
  isLast?: boolean;
}) {
  const color = destructive ? colors.danger : disabled ? colors.mutedLight : colors.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.actionRow, isLast && styles.fieldRowLast, pressed && !disabled && styles.rowPressed]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, { color }]}>{label}</Text>
        {hint ? <Text style={styles.actionHint}>{hint}</Text> : null}
      </View>
      {!disabled && <Ionicons name="chevron-forward" size={14} color={colors.mutedLight} />}
    </Pressable>
  );
}

// ─── ToggleRow ────────────────────────────────────────────────────────────────

function ToggleRow({
  icon, label, hint, active, onPress, isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  active: boolean;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, isLast && styles.fieldRowLast, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={16} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.actionLabel}>{label}</Text>
        {hint ? <Text style={styles.actionHint}>{hint}</Text> : null}
      </View>
      <View style={[styles.toggleTrack, active && styles.toggleTrackActive]}>
        <View style={[styles.toggleThumb, active && styles.toggleThumbActive]} />
      </View>
    </Pressable>
  );
}

// ─── TogglePill ───────────────────────────────────────────────────────────────

function TogglePill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.togglePill, active && styles.togglePillActive]}>
      <Text style={[styles.togglePillText, active && styles.togglePillTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ─── SaveRow ──────────────────────────────────────────────────────────────────

function SaveRow({ isSaving, checkState, onPress }: { isSaving: boolean; checkState: CheckState; onPress: () => void }) {
  return (
    <View style={styles.saveRow}>
      <Pressable
        disabled={isSaving}
        onPress={onPress}
        style={({ pressed }) => [styles.saveBtn, isSaving && styles.saveBtnDisabled, pressed && styles.saveBtnPressed]}
      >
        {isSaving
          ? <ActivityIndicator color="#fff" size="small" />
          : <>
              <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>Save &amp; test connection</Text>
            </>}
      </Pressable>
      {checkState.message ? (
        <Text style={[styles.checkMsg, checkState.status === "error" ? styles.checkMsgError : styles.checkMsgOk]}>
          {checkState.message}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.panel,
    ...shadows.sm,
  },
  headerLeft: { flex: 1, gap: 2 },
  pageTitle: { color: colors.ink, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  pageSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center" },

  // Scroll
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: 60,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },

  // Section card
  section: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: colors.panel,
    overflow: "hidden",
    ...shadows.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
    backgroundColor: colors.panelSoft,
  },
  sectionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sectionHeaderText: { flex: 1, gap: 1 },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { color: colors.muted, fontSize: 11, fontWeight: "500" },
  sectionBody: { gap: 0 },

  // Field rows
  fieldRow: {
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  fieldRowLast: { borderBottomWidth: 0 },
  fieldLabelRow: {},
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  // Input with inline paste icon
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: colors.lineSoft,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  inputInner: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  pasteIconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  pasteBtn: {},
  pasteBtnText: {},
  pasteBtnTextDone: {},
  input: {
    minHeight: 40,
    borderWidth: 1.5,
    borderColor: colors.lineSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.bg,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },

  // Voice picker row
  voiceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  voiceValue: { flexDirection: "row", alignItems: "center", gap: 4 },
  voiceValueText: { color: colors.ink, fontSize: 13, fontWeight: "700", maxWidth: 160 },

  // Action row
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  actionLabel: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  actionHint: { color: colors.mutedLight, fontSize: 11, fontWeight: "500", marginTop: 1 },
  rowPressed: { backgroundColor: colors.panelSoft },

  // iOS-style toggle switch
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.line,
    justifyContent: "center",
    paddingHorizontal: 3,
    flexShrink: 0,
  },
  toggleTrackActive: { backgroundColor: colors.accent },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    ...shadows.sm,
  },
  toggleThumbActive: { alignSelf: "flex-end" },

  // Toggle pill (header)
  togglePill: {
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
    flexShrink: 0,
  },
  togglePillActive: { borderColor: colors.accentMid, backgroundColor: colors.accentSoft },
  togglePillText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  togglePillTextActive: { color: colors.accentStrong },

  // Save button
  saveRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 6 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    ...shadows.sm,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  checkMsg: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  checkMsgOk: { color: colors.accentStrong },
  checkMsgError: { color: colors.danger },

  // Non-stop preload
  preloadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.sm,
  },
  preloadLabel: { color: colors.ink, fontSize: 14, fontWeight: "700", flex: 1 },
  segmentRow: { flexDirection: "row", gap: 6 },
  segmentBtn: {
    width: 40,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelSoft,
  },
  segmentBtnActive: { borderColor: colors.accentMid, backgroundColor: colors.accentSoft },
  segmentBtnText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  segmentBtnTextActive: { color: colors.accentStrong },

  // Sync stats
  syncStats: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 4,
  },
  syncStat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    backgroundColor: colors.panelSoft,
  },
  syncStatValue: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  syncStatLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", marginTop: 2 },

  // Feedback
  feedbackOk: { color: colors.accentStrong, fontSize: 12, fontWeight: "700", paddingHorizontal: spacing.md, paddingBottom: 8 },

  // Popup sheet
  popupBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(10,20,17,0.42)" },
  popupLayer: { flex: 1, justifyContent: "flex-end" },
  popupSheet: {
    maxHeight: "75%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.panel,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
  popupHandle: { width: 42, height: 4, alignSelf: "center", borderRadius: 99, backgroundColor: colors.line, marginBottom: spacing.sm },
  popupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm, minHeight: 44 },
  popupTitle: { color: colors.ink, fontSize: 18, fontWeight: "900", flex: 1 },
  popupCloseBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.panelSoft },
  popupList: { gap: spacing.xs, paddingBottom: spacing.lg },
  popupItem: {
    minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: colors.line, borderRadius: 14,
    paddingHorizontal: spacing.md, backgroundColor: colors.panelSoft,
  },
  popupItemActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  popupItemText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "800", marginRight: spacing.sm },
  popupItemTextActive: { color: colors.accentStrong },

  // Footer
  versionNote: {
    textAlign: "center",
    color: colors.mutedLight,
    fontSize: 11,
    fontWeight: "500",
    marginTop: spacing.xs,
  },
});
