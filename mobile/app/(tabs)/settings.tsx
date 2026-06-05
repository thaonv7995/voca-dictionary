import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { colors, spacing } from "../../src/theme";
import { BodyText, PrimaryButton, SecondaryButton, SectionTitle, StatusPill } from "../../src/ui";

type CheckState = {
  status: "idle" | "checking" | "success" | "error";
  message: string;
};

export default function SettingsTabScreen() {
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const [settings, setSettings] = useState<ApiSettings>({
    baseUrl: "",
    token: "",
    llmBaseUrl: "",
    llmApiKey: "",
    llmModel: "",
    ttsEndpoint: "",
    ttsModel: defaultTtsModel,
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
    Promise.all([loadApiSettings(), loadAudioWifiOnly(), loadNonStopListeningEnabled(), loadNonStopPreloadCount(), loadPendingSyncSummary(), loadClientErrors()])
      .then(([apiSettings, wifiOnly, nonStop, preloadCount, pendingSummary, errorLog]) => {
        setSettings(apiSettings);
        setAudioWifiOnly(wifiOnly);
        setNonStopEnabled(nonStop);
        setNonStopPreloadCount(preloadCount);
        setPending(pendingSummary);
        setErrors(errorLog);
      })
      .finally(() => setLoading(false));
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

  if (loading) {
    return (
      <SafeAreaView edges={[]} style={styles.safeRoot}>
        <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
          <View style={styles.pageHeaderMain}>
            <View style={styles.pageHeaderCopy}>
              <Text style={styles.pageTitle}>Settings</Text>
            </View>
            <StatusPill label={network.online ? network.label : "Offline"} tone={network.online ? "success" : "danger"} />
          </View>
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={[]} style={styles.safeRoot}>
      <View style={[styles.pageHeader, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.pageHeaderMain}>
          <View style={styles.pageHeaderCopy}>
            <Text style={styles.pageTitle}>Settings</Text>
            <Text style={styles.pageSubtitle}>Providers, voice & sync</Text>
          </View>
          <StatusPill label={network.online ? network.label : "Offline"} tone={network.online ? "success" : "danger"} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={styles.panel}>
          <View style={styles.sectionHead}>
            <Text style={styles.eyebrow}>Bridge</Text>
            <SectionTitle>Voca API</SectionTitle>
            <BodyText>Endpoint and shared token for the mobile cloud bridge.</BodyText>
          </View>
          <Field label="Base URL">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(baseUrl) => setSettings((current) => ({ ...current, baseUrl }))}
              placeholder="https://voca-api.example.com"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={settings.baseUrl}
            />
          </Field>
          <Field label="API token">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(token) => setSettings((current) => ({ ...current, token }))}
              placeholder="Shared Voca API token"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={settings.token}
            />
          </Field>
          <PrimaryButton
            disabled={checkState.status === "checking"}
            label={checkState.status === "checking" ? "Checking…" : "Save & test connection"}
            onPress={saveAndCheck}
          />
          {checkState.message ? (
            <Text style={[styles.feedback, checkState.status === "error" ? styles.feedbackError : styles.feedbackOk]}>
              {checkState.message}
            </Text>
          ) : null}
        </View>

        <View style={styles.panel}>
          <View style={styles.sectionHead}>
            <Text style={styles.eyebrow}>LLM</Text>
            <SectionTitle>Model provider</SectionTitle>
            <BodyText>Used for create-card, agent, and practice streams (same as web).</BodyText>
          </View>
          <Field label="Base URL">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(llmBaseUrl) => setSettings((current) => ({ ...current, llmBaseUrl }))}
              placeholder="https://api.openai.com/v1"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={settings.llmBaseUrl}
            />
          </Field>
          <Field label="API key">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(llmApiKey) => setSettings((current) => ({ ...current, llmApiKey }))}
              placeholder="Provider key"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={settings.llmApiKey}
            />
          </Field>
          <Field label="Model">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(llmModel) => setSettings((current) => ({ ...current, llmModel }))}
              placeholder="gpt-4.1-mini"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={settings.llmModel}
            />
          </Field>
        </View>

        <View style={styles.panel}>
          <View style={styles.rowTitle}>
            <View style={styles.sectionHeadFlat}>
              <Text style={styles.eyebrow}>Speech</Text>
              <SectionTitle>Voice & TTS</SectionTitle>
            </View>
            <TogglePill
              active={settings.useApiTts}
              label={settings.useApiTts ? "API TTS on" : "API TTS off"}
              onPress={() => setSettings((current) => ({ ...current, useApiTts: !current.useApiTts }))}
            />
          </View>
          <BodyText>Card audio and speech generation use these endpoints when enabled.</BodyText>
          <Field label="Speech endpoint">
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={(ttsEndpoint) => setSettings((current) => ({ ...current, ttsEndpoint }))}
              placeholder="Optional — else base URL + /audio/speech"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={settings.ttsEndpoint}
            />
          </Field>
          <Field label="Voice model">
            <VoicePicker
              sheetTitle="Voice model"
              onChange={(ttsModel) => setSettings((current) => ({ ...current, ttsModel }))}
              value={settings.ttsModel}
            />
          </Field>
          <PrimaryButton
            disabled={checkState.status === "checking"}
            label="Save provider settings"
            onPress={saveAndCheck}
          />
        </View>

        <View style={styles.panel}>
          <View style={styles.rowTitle}>
            <View style={styles.sectionHeadFlat}>
              <Text style={styles.eyebrow}>Listen</Text>
              <SectionTitle>Conversation voices</SectionTitle>
            </View>
            <TogglePill
              active={settings.conversationAutoSelectVoices}
              label={settings.conversationAutoSelectVoices ? "Auto" : "Manual"}
              onPress={() =>
                setSettings((current) => ({ ...current, conversationAutoSelectVoices: !current.conversationAutoSelectVoices }))
              }
            />
          </View>
          <BodyText>Speaker lines A / B / C in generated conversations.</BodyText>
          <Field label="Voice A">
            <VoicePicker
              sheetTitle="Voice A"
              onChange={(conversationVoiceA) => setSettings((current) => ({ ...current, conversationVoiceA }))}
              value={settings.conversationVoiceA}
            />
          </Field>
          <Field label="Voice B">
            <VoicePicker
              sheetTitle="Voice B"
              onChange={(conversationVoiceB) => setSettings((current) => ({ ...current, conversationVoiceB }))}
              value={settings.conversationVoiceB}
            />
          </Field>
          <Field label="Voice C">
            <VoicePicker
              sheetTitle="Voice C"
              onChange={(conversationVoiceC) => setSettings((current) => ({ ...current, conversationVoiceC }))}
              value={settings.conversationVoiceC}
            />
          </Field>
        </View>

        <View style={styles.panel}>
          <View style={styles.rowTitle}>
            <View style={styles.sectionHeadFlat}>
              <Text style={styles.eyebrow}>Non-stop</Text>
              <SectionTitle>Listening queue</SectionTitle>
            </View>
            <TogglePill
              active={nonStopEnabled}
              label={nonStopEnabled ? "On" : "Off"}
              onPress={() => {
                const next = !nonStopEnabled;
                setNonStopEnabled(next);
                void saveNonStopListeningEnabled(next);
              }}
            />
          </View>
          <BodyText>Pre-generate listening items and TTS audio so Play can continue until you stop it.</BodyText>
          <View style={styles.segmentRow}>
            {[1, 2, 3].map((count) => (
              <Pressable
                key={count}
                onPress={() => {
                  setNonStopPreloadCount(count);
                  void saveNonStopPreloadCount(count);
                }}
                style={[styles.segmentButton, nonStopPreloadCount === count && styles.segmentButtonActive]}
              >
                <Text style={[styles.segmentText, nonStopPreloadCount === count && styles.segmentTextActive]}>{count} next</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.sectionHead}>
            <Text style={styles.eyebrow}>Queue</Text>
            <SectionTitle>Offline sync</SectionTitle>
            <BodyText>Pending changes flush when you are back online.</BodyText>
          </View>
          <View style={styles.syncStats}>
            <View style={styles.syncStat}>
              <Text style={styles.syncStatValue}>{pending.total}</Text>
              <Text style={styles.syncStatLabel}>Total</Text>
            </View>
            <View style={styles.syncStat}>
              <Text style={styles.syncStatValue}>{pending.levelUpdates}</Text>
              <Text style={styles.syncStatLabel}>Levels</Text>
            </View>
            <View style={styles.syncStat}>
              <Text style={styles.syncStatValue}>{pending.practiceAttempts}</Text>
              <Text style={styles.syncStatLabel}>Practice</Text>
            </View>
          </View>
          <PrimaryButton
            disabled={!pending.total || !network.online}
            label={pending.total ? "Retry pending sync" : "Nothing pending"}
            onPress={async () => {
              const next = await flushPendingSync();
              setPending(next);
            }}
          />
          {!network.online ? (
            <Text style={styles.feedbackMuted}>Reconnect to Wi‑Fi or cellular to flush the queue.</Text>
          ) : null}
        </View>

        <View style={styles.panel}>
          <View style={styles.sectionHead}>
            <Text style={styles.eyebrow}>Storage</Text>
            <SectionTitle>Cache</SectionTitle>
            <BodyText>Clear downloaded card images and TTS audio stored on device.</BodyText>
          </View>
          <View style={styles.cacheActions}>
            <SecondaryButton
              label="Clear image cache"
              onPress={() => {
                clearCardImageCache();
                setCacheMessage("Image cache cleared.");
              }}
            />
            <SecondaryButton
              label="Clear audio cache"
              onPress={() => {
                clearAudioCache();
                setCacheMessage("Audio cache cleared.");
              }}
            />
          </View>
          <Pressable
            onPress={() => {
              const next = !audioWifiOnly;
              setAudioWifiOnly(next);
              void saveAudioWifiOnly(next);
            }}
            style={({ pressed }) => [styles.networkToggleRow, pressed && styles.networkToggleRowPressed]}
          >
            <View>
              <Text style={styles.networkToggleTitle}>Audio downloads</Text>
              <Text style={styles.networkToggleHint}>{audioWifiOnly ? "Wi‑Fi and ethernet only" : "Any network"}</Text>
            </View>
            <Text style={styles.networkToggleChevron}>›</Text>
          </Pressable>
          {cacheMessage ? <Text style={styles.feedbackOk}>{cacheMessage}</Text> : null}
        </View>

        <View style={[styles.panel, styles.panelDiagnostics]}>
          <View style={styles.sectionHead}>
            <Text style={styles.eyebrow}>QA</Text>
            <SectionTitle>Diagnostics</SectionTitle>
            <BodyText>Local error logs — no tokens are included.</BodyText>
          </View>
          <Text style={styles.diagCount}>{errors.length ? `${errors.length} entries` : "No entries"}</Text>
          <SecondaryButton
            label="Clear error logs"
            onPress={async () => {
              await clearClientErrors();
              setErrors([]);
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function TogglePill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggle, active && styles.toggleActive]}>
      <Text style={[styles.toggleText, active && styles.toggleTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function VoicePicker({
  sheetTitle,
  value,
  onChange,
}: {
  sheetTitle: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const selected = ttsVoiceOptions.find((opt) => opt.value === value);

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
    <View style={styles.voicePickerWrap}>
      <Pressable
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.choiceTrigger, pressed && styles.choiceTriggerPressed]}
      >
        <Text numberOfLines={2} style={styles.choiceTriggerText}>
          {selected?.label ?? "Choose…"}
        </Text>
        <Text style={styles.choiceChevron}>›</Text>
      </Pressable>
      <Modal animationType="none" transparent visible={visible} onRequestClose={close}>
        <Animated.View style={[styles.popupBackdrop, { opacity: backdropOpacity }]}>
          <Pressable accessibilityRole="button" onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <View pointerEvents="box-none" style={styles.popupLayer}>
          <Animated.View style={[styles.popupSheet, { transform: [{ translateY: sheetTransform }] }]}>
            <View style={styles.popupHandle} />
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>{sheetTitle}</Text>
              <Pressable accessibilityRole="button" onPress={close} style={styles.popupCloseButton}>
                <Text style={styles.popupCloseText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.popupScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.popupScroll}
            >
              {ttsVoiceOptions.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    onChange(opt.value);
                    close();
                  }}
                  style={[styles.popupItem, value === opt.value && styles.popupItemActive]}
                >
                  <Text style={[styles.popupItemText, value === opt.value && styles.popupItemTextActive]}>{opt.label}</Text>
                  {value === opt.value ? <Text style={styles.popupCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
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
  pageHeaderMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  pageHeaderCopy: { flex: 1, minWidth: 0, gap: 3 },
  pageTitle: { color: colors.ink, fontSize: 22, fontWeight: "900" },
  pageSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 40,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  panel: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.panel,
  },
  panelDiagnostics: {
    backgroundColor: colors.panelSoft,
  },
  sectionHead: { gap: 6, marginBottom: 4 },
  sectionHeadFlat: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: {
    color: colors.accentStrong,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  rowTitle: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: 4,
  },
  field: { gap: 6 },
  fieldLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  feedback: { fontSize: 13, fontWeight: "800", lineHeight: 18 },
  feedbackOk: { color: colors.accentStrong },
  feedbackError: { color: colors.danger },
  feedbackMuted: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  segmentRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    backgroundColor: colors.panelSoft,
  },
  segmentButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: colors.accentStrong,
  },

  toggle: {
    maxWidth: "48%",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.panelSoft,
    flexShrink: 0,
  },
  toggleActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  toggleText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  toggleTextActive: {
    color: colors.accentStrong,
  },

  voicePickerWrap: { width: "100%" },
  choiceTrigger: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.panelSoft,
  },
  choiceTriggerPressed: { opacity: 0.88 },
  choiceTriggerText: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  choiceChevron: {
    color: colors.muted,
    fontSize: 20,
    fontWeight: "300",
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
    maxHeight: "75%",
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
    marginBottom: spacing.sm,
  },
  popupHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  popupTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    flex: 1,
    marginRight: spacing.sm,
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
  popupScroll: { maxHeight: 400 },
  popupScrollContent: { gap: spacing.xs, paddingBottom: spacing.md },
  popupItem: {
    minHeight: 52,
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
    fontSize: 14,
    fontWeight: "800",
    marginRight: spacing.sm,
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

  syncStats: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  syncStat: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.panelSoft,
    alignItems: "center",
  },
  syncStatValue: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  syncStatLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase", marginTop: 2 },

  cacheActions: { gap: spacing.xs },
  networkToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  networkToggleRowPressed: { opacity: 0.88 },
  networkToggleTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  networkToggleHint: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 3 },
  networkToggleChevron: { color: colors.muted, fontSize: 22, fontWeight: "300" },

  diagCount: { color: colors.muted, fontSize: 14, fontWeight: "800" },
});
