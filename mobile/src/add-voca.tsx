import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createCard, loadCachedCards, refreshCards, type MobileCard } from "./cards";
import { logClientError } from "./logging";
import { colors, radius, shadows, spacing } from "./theme";
import { BodyText, PrimaryButton, SectionTitle } from "./ui";

// ─── Types ────────────────────────────────────────────────────────────────────

type AddVocaFormProps = {
  /** Submit in the background and return control immediately. */
  backgroundSubmit?: boolean;
  /** Extra hook after card is created and cache refreshed (e.g. parent reload). */
  onAfterSuccess?: () => void | Promise<void>;
  /** Hook fired immediately after a valid word is queued. */
  onQueued?: (word: string) => void;
  /** Show long intro copy (full screen). Hidden in modal. */
  showDescription?: boolean;
};

type AddVocaModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
};

// ─── Suggestion logic ─────────────────────────────────────────────────────────

/**
 * Tìm từ gợi ý từ cached cards dựa trên prefix người dùng đang nhập.
 * Chỉ gợi ý các từ chưa có trong library (word không match chính xác).
 */
function buildSuggestions(query: string, cards: MobileCard[]): string[] {
  if (!query.trim() || query.length < 2) return [];
  const q = query.toLowerCase().trim();
  // Tìm các từ đã có match để exclude (exact word matches)
  const existingWords = new Set(cards.map((c) => c.word.toLowerCase()));
  // Gợi ý từ các collocations, tags, hoặc partial matches
  const matches = new Set<string>();
  for (const card of cards) {
    // Gợi ý từ nhiều form (plural, etc) không chính xác match
    for (const tag of card.tags || []) {
      if (tag.toLowerCase().startsWith(q) && !existingWords.has(tag.toLowerCase())) {
        matches.add(tag);
      }
    }
    // Nếu từ trong library bắt đầu bằng query → gợi ý compound/phát sinh
    if (card.word.toLowerCase().startsWith(q) && card.word.toLowerCase() !== q) {
      // Gợi ý các form phổ biến
      const forms = [
        `${card.word}ing`,
        `${card.word}ed`,
        `${card.word}er`,
        `${card.word}s`,
        `${card.word} up`,
        `${card.word} out`,
      ].filter((f) => !existingWords.has(f.toLowerCase()) && f.toLowerCase().startsWith(q));
      for (const f of forms.slice(0, 2)) matches.add(f);
    }
  }
  return Array.from(matches).slice(0, 5);
}

// ─── Clipboard Paste Helper ───────────────────────────────────────────────────

async function getClipboardWord(): Promise<string> {
  try {
    const text = await Clipboard.getStringAsync();
    // Only return if it looks like a single word or short phrase (≤ 40 chars, no newlines)
    if (text && text.length <= 40 && !text.includes("\n")) {
      return text.trim();
    }
    return "";
  } catch {
    return "";
  }
}

// ─── OCR via Image Picker ─────────────────────────────────────────────────────

/**
 * Mở camera để chụp ảnh, sau đó dùng clipboard để lấy text (giả lập OCR flow).
 * Trong thực tế, có thể tích hợp VisionKit (iOS native) hoặc Google ML Kit.
 * Hiện tại: cho phép user chọn ảnh từ thư viện, nhắc user copy text từ ảnh.
 */
async function pickImageForScan(): Promise<{ uri: string } | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    // Try gallery as fallback
    const galleryStatus = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (galleryStatus.status !== "granted") return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return null;
    return { uri: result.assets[0].uri };
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;
  return { uri: result.assets[0].uri };
}

// ─── AddVocaForm ──────────────────────────────────────────────────────────────

export function AddVocaForm({
  backgroundSubmit = false,
  onAfterSuccess,
  onQueued,
  showDescription = true,
}: AddVocaFormProps) {
  const [word, setWord] = useState("");
  const [creating, setCreating] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [cards, setCards] = useState<MobileCard[]>([]);
  const [clipboardWord, setClipboardWord] = useState("");

  // Load cards cache for suggestions
  useEffect(() => {
    loadCachedCards().then((snapshot) => {
      if (snapshot?.cards) setCards(snapshot.cards);
    }).catch(() => undefined);
    getClipboardWord().then((text) => {
      if (text) setClipboardWord(text);
    });
  }, []);

  // Update suggestions as user types
  useEffect(() => {
    const timer = setTimeout(() => {
      setSuggestions(buildSuggestions(word, cards));
    }, 200);
    return () => clearTimeout(timer);
  }, [word, cards]);

  async function submit(wordToSubmit?: string) {
    const normalized = (wordToSubmit ?? word).trim();
    if (!normalized || creating) return;
    if (backgroundSubmit) {
      setWord("");
      onQueued?.(normalized);
      void createCardInBackground(normalized, onAfterSuccess);
      return;
    }
    setCreating(true);
    setError("");
    setEvents(["Creating card..."]);
    try {
      await createCard(normalized, (event) => {
        if (event.message) setEvents((current) => [event.message || "", ...current].slice(0, 8));
      });
      await refreshCards();
      setEvents((current) => ["✅ Card created and dictionary refreshed.", ...current].slice(0, 8));
      await onAfterSuccess?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Cannot create card.");
    } finally {
      setCreating(false);
    }
  }

  async function handleScan() {
    const result = await pickImageForScan();
    if (!result) return;
    // After picking, check clipboard (user may have copied from photo)
    const clip = await getClipboardWord();
    if (clip && clip !== word) {
      setWord(clip);
    } else {
      setError("Chụp xong, copy từ trong ảnh rồi nhấn 📋 để dán vào.");
    }
  }

  async function handlePasteClipboard() {
    const clip = await getClipboardWord();
    if (clip) {
      setWord(clip);
      setClipboardWord("");
    }
  }

  return (
    <View style={styles.form}>
      {showDescription ? (
        <>
          <SectionTitle>Add to your library</SectionTitle>
          <BodyText>
            Submit a word to the Voca API bridge, wait for generation, then refresh the cards manifest.
          </BodyText>
        </>
      ) : null}

      {/* Input row with action buttons */}
      <View style={styles.inputShell}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setWord}
          placeholder="Type a word or phrase…"
          placeholderTextColor={colors.muted}
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          style={styles.input}
          value={word}
        />
        <View style={styles.inputActions}>
          {/* Clipboard paste */}
          {clipboardWord && clipboardWord !== word ? (
            <Pressable onPress={() => void handlePasteClipboard()} style={styles.inputActionBtn}>
              <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
            </Pressable>
          ) : null}
          {/* Mic icon — triggers iOS native voice dictation via TextInput */}
          <MicButton onResult={(text) => setWord(text)} />
          {/* Scan / Camera */}
          <Pressable onPress={() => void handleScan()} style={styles.inputActionBtn}>
            <Ionicons name="camera-outline" size={18} color={colors.muted} />
          </Pressable>
          {/* Clear */}
          {word.length > 0 ? (
            <Pressable onPress={() => setWord("")} style={styles.inputActionBtn}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Clipboard preview chip */}
      {clipboardWord && clipboardWord !== word ? (
        <Pressable onPress={() => void handlePasteClipboard()} style={styles.clipboardChip}>
          <Ionicons name="clipboard-outline" size={12} color={colors.accentStrong} />
          <Text style={styles.clipboardChipText} numberOfLines={1}>Dán từ clipboard: "{clipboardWord}"</Text>
        </Pressable>
      ) : null}

      {/* Smart suggestions */}
      {suggestions.length > 0 ? (
        <View style={styles.suggestionsRow}>
          <Text style={styles.suggestionsLabel}>Gợi ý</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsScroll}>
            {suggestions.map((sug) => (
              <Pressable
                key={sug}
                onPress={() => setWord(sug)}
                style={({ pressed }) => [styles.suggestionChip, pressed && styles.suggestionChipPressed]}
              >
                <Text style={styles.suggestionChipText}>{sug}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Submit button */}
      <PrimaryButton
        disabled={!word.trim() || creating}
        label={creating ? "Generating card…" : "Generate card ✦"}
        onPress={() => void submit()}
      />

      {/* Error */}
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="warning-outline" size={14} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      {/* Events log */}
      {events.length > 0 ? (
        <View style={styles.eventsBox}>
          {events.map((event, index) => (
            <Text key={`${event}-${index}`} style={styles.event}>
              {event}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ─── Mic Button ───────────────────────────────────────────────────────────────

/**
 * Kích hoạt voice dictation của iOS bằng cách focus một hidden TextInput
 * và trigger voice input programmatically. Trên Android hiển thị hint.
 */
function MicButton({ onResult }: { onResult: (text: string) => void }) {
  const hiddenInputRef = useRef<TextInput>(null);
  const [listening, setListening] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!listening) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [listening, pulseAnim]);

  function startListening() {
    setListening(true);
    // Focus hidden input — iOS will show voice dictation button in keyboard
    setTimeout(() => hiddenInputRef.current?.focus(), 100);
  }

  return (
    <>
      {/* Hidden TextInput to capture voice input */}
      <TextInput
        ref={hiddenInputRef}
        style={styles.hiddenInput}
        onChangeText={(text) => {
          if (text.trim()) {
            onResult(text.trim());
            setListening(false);
          }
        }}
        onBlur={() => setListening(false)}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <Pressable
        onPress={startListening}
        style={[styles.inputActionBtn, listening && styles.inputActionBtnActive]}
      >
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Ionicons
            name={listening ? "mic" : "mic-outline"}
            size={18}
            color={listening ? colors.accent : colors.muted}
          />
        </Animated.View>
      </Pressable>
    </>
  );
}

// ─── Background create ────────────────────────────────────────────────────────

async function createCardInBackground(
  word: string,
  onAfterSuccess?: () => void | Promise<void>,
) {
  try {
    await createCard(word, () => undefined);
    await refreshCards();
    await onAfterSuccess?.();
  } catch (error) {
    await logClientError(error, "add-voca-background");
  }
}

// ─── AddVocaModal ─────────────────────────────────────────────────────────────

export function AddVocaModal({ visible, onClose, onCreated }: AddVocaModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalKav}
        >
          <View
            style={[
              styles.modalCard,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            {/* Handle bar */}
            <View style={styles.modalHandle} />

            {/* Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Add Vocabulary</Text>
                <Text style={styles.modalSubtitle}>Voice · Scan · Type</Text>
              </View>
              <Pressable accessibilityRole="button" hitSlop={16} onPress={onClose} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {/* Quick access tips */}
            <View style={styles.methodRow}>
              <MethodPill icon="mic-outline" label="Mic" hint="Dùng giọng nói" />
              <MethodPill icon="camera-outline" label="Scan" hint="Chụp từ ảnh" />
              <MethodPill icon="clipboard-outline" label="Paste" hint="Từ clipboard" />
              <MethodPill icon="text-outline" label="Type" hint="Nhập tay" />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
            >
              <AddVocaForm
                backgroundSubmit
                showDescription={false}
                onQueued={() => {
                  onClose();
                }}
                onAfterSuccess={onCreated}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function MethodPill({ icon, label, hint }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; hint: string }) {
  return (
    <View style={styles.methodPill}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={styles.methodPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },

  // Input area
  inputShell: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.panelSoft,
    overflow: "hidden",
    ...shadows.sm,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  inputActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
  },
  inputActionBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: "transparent",
  },
  inputActionBtnActive: {
    backgroundColor: colors.accentSoft,
  },
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },

  // Clipboard
  clipboardChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.accentMid,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: colors.accentSoft,
  },
  clipboardChipText: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "700",
    maxWidth: 200,
  },

  // Suggestions
  suggestionsRow: {
    gap: 6,
  },
  suggestionsLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  suggestionsScroll: {
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  suggestionChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.panel,
    ...shadows.sm,
  },
  suggestionChipPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentMid,
  },
  suggestionChipText: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: "700",
  },

  // Error & events
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  eventsBox: {
    gap: 4,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  event: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },

  // Modal
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8, 18, 15, 0.52)",
  },
  modalKav: {
    width: "100%",
  },
  modalCard: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.panel,
    ...shadows.sheet,
  },
  modalHandle: {
    width: 44,
    height: 4,
    alignSelf: "center",
    borderRadius: radius.full,
    backgroundColor: colors.line,
    marginBottom: spacing.sm,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },

  // Method row
  methodRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  methodPill: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    padding: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.panelSoft,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  methodPillLabel: {
    color: colors.ink,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  modalScroll: {
    maxHeight: 460,
  },
  modalScrollContent: {
    paddingVertical: spacing.xs,
    paddingBottom: spacing.md,
  },
});
