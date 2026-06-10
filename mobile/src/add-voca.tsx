import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import TextRecognition from "@react-native-ml-kit/text-recognition";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

// ─── OCR via ML Kit (on-device) ──────────────────────────────────────────────

/**
 * Chụp ảnh / chọn từ gallery → ML Kit text recognition on-device
 * → trả về danh sách từ tiếng Anh phát hiện được.
 */
async function pickAndScanImage(source: "camera" | "gallery"): Promise<string[]> {
  let imageUri: string | null = null;

  if (source === "camera") {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      const req = await ImagePicker.requestCameraPermissionsAsync();
      if (req.status !== "granted") {
        throw new Error("Quyền Camera bị từ chối.");
      }
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) imageUri = result.assets[0].uri;
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (req.status !== "granted") {
        throw new Error("Quyền truy cập thư viện ảnh bị từ chối.");
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) imageUri = result.assets[0].uri;
  }

  if (!imageUri) return [];

  // Chạy ML Kit OCR on-device
  const recognized = await TextRecognition.recognize(imageUri);

  const wordSet = new Set<string>();
  const lowercasedSet = new Set<string>();

  // Loại bỏ các stop words phổ biến trong tiếng Anh để gợi ý thông minh hơn
  const stopWords = new Set([
    "the", "and", "of", "to", "a", "an", "in", "is", "it", "you", "that", "he", "was", "for", "on",
    "are", "as", "with", "his", "they", "i", "at", "be", "this", "have", "from", "or", "one", "had",
    "by", "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", "there",
    "use", "each", "which", "she", "do", "how", "their", "if", "will", "up", "other", "about",
    "out", "many", "then", "them", "these", "so", "some", "her", "would", "make", "like", "him",
    "into", "time", "has", "look", "two", "more", "write", "go", "see", "number", "no", "way",
    "could", "people", "my", "than", "first", "water", "been", "call", "who", "oil", "its", "now",
    "find"
  ]);

  for (const block of recognized.blocks) {
    for (const line of block.lines) {
      // 1. Phân tích từ đơn (tokens)
      const tokens = line.text
        .split(/\s+/)
        .map((t) => t.replace(/[^a-zA-Z'\-]/g, "").trim())
        .filter((t) => t.length >= 2 && /^[a-zA-Z]/.test(t));

      for (const token of tokens) {
        const lower = token.toLowerCase();
        if (!stopWords.has(lower) && !lowercasedSet.has(lower)) {
          lowercasedSet.add(lower);
          wordSet.add(token); // Giữ casing ban đầu (ví dụ: JavaScript, iOS)
        }
      }

      // 2. Phân tích nguyên dòng cụm từ (phrase)
      const lineClean = line.text.replace(/[^a-zA-Z '\-]/g, " ").replace(/\s+/g, " ").trim();
      if (lineClean.length >= 3 && lineClean.length <= 40) {
        const lowerLine = lineClean.toLowerCase();
        if (!stopWords.has(lowerLine) && !lowercasedSet.has(lowerLine)) {
          lowercasedSet.add(lowerLine);
          wordSet.add(lineClean);
        }
      }
    }
  }

  // Giữ nguyên thứ tự đọc văn bản gốc từ trên xuống dưới
  return Array.from(wordSet).slice(0, 20);
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
  // OCR
  const [scanning, setScanning] = useState(false);
  const [ocrWords, setOcrWords] = useState<string[]>([]);

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
    Alert.alert(
      "Chọn nguồn ảnh",
      "Bạn muốn chụp ảnh mới hay chọn từ thư viện ảnh?",
      [
        {
          text: "Chụp ảnh 📸",
          onPress: () => void startScan("camera"),
        },
        {
          text: "Chọn từ thư viện 🖼️",
          onPress: () => void startScan("gallery"),
        },
        {
          text: "Hủy",
          style: "cancel",
        },
      ]
    );
  }

  async function startScan(source: "camera" | "gallery") {
    setScanning(true);
    setError("");
    setOcrWords([]);
    try {
      const words = await pickAndScanImage(source);
      if (words.length === 0) {
        setError("Không phát hiện được từ nào. Thử ảnh rõ hơn.");
      } else {
        setOcrWords(words);
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan thất bại. Thử lại.");
    } finally {
      setScanning(false);
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
          <Pressable
            onPress={() => void handleScan()}
            disabled={scanning}
            style={[styles.inputActionBtn, scanning && styles.inputActionBtnActive]}
          >
            {scanning
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Ionicons name="camera-outline" size={18} color={colors.muted} />}
          </Pressable>
          {/* Clear */}
          {word.length > 0 ? (
            <Pressable onPress={() => setWord("")} style={styles.inputActionBtn}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* OCR word picker */}
      {ocrWords.length > 0 ? (
        <View style={styles.ocrResultBox}>
          <View style={styles.ocrResultHeader}>
            <Ionicons name="scan-outline" size={14} color={colors.accentStrong} />
            <Text style={styles.ocrResultTitle}>Chọn từ để thêm</Text>
            <Pressable onPress={() => setOcrWords([])} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.ocrWordList}
          >
            {ocrWords.map((w) => (
              <Pressable
                key={w}
                onPress={() => { setWord(w); setOcrWords([]); }}
                style={({ pressed }) => [styles.ocrWord, pressed && styles.ocrWordPressed]}
              >
                <Text style={styles.ocrWordText}>{w}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

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
 * Voice input dùng expo-speech-recognition (iOS SFSpeechRecognizer native).
 * Real-time transcription, hỗ trợ English và tiếng Việt.
 */
function MicButton({ onResult }: { onResult: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [partialText, setPartialText] = useState("");
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation khi đang nghe
  useEffect(() => {
    if (!listening) { pulseAnim.setValue(1); return; }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [listening, pulseAnim]);

  // Listen for real-time partial results
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      if (transcript.trim()) onResult(transcript.trim());
      setListening(false);
      setPartialText("");
    } else {
      setPartialText(transcript);
    }
  });

  useSpeechRecognitionEvent("error", () => {
    setListening(false);
    setPartialText("");
  });

  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setPartialText("");
  });

  async function toggleListening() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      setListening(false);
      return;
    }
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) return;
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
    });
  }

  return (
    <>
      {partialText ? (
        <View style={styles.partialTextBubble}>
          <Text style={styles.partialTextLabel} numberOfLines={1}>{partialText}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => void toggleListening()}
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
  partialTextBubble: {
    flex: 1,
    paddingHorizontal: spacing.xs,
    justifyContent: "center",
  },
  partialTextLabel: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "700",
    fontStyle: "italic",
  },

  // OCR word picker
  ocrResultBox: {
    borderWidth: 1,
    borderColor: colors.accentMid,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    overflow: "hidden",
  },
  ocrResultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.accentMid,
  },
  ocrResultTitle: {
    flex: 1,
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  ocrWordList: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  ocrWord: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accentMid,
    backgroundColor: colors.panel,
  },
  ocrWordPressed: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  ocrWordText: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: "700",
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
