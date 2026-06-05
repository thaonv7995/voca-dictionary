import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createCard, refreshCards } from "./cards";
import { logClientError } from "./logging";
import { colors, spacing } from "./theme";
import { BodyText, PrimaryButton, SectionTitle } from "./ui";

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

export function AddVocaForm({ backgroundSubmit = false, onAfterSuccess, onQueued, showDescription = true }: AddVocaFormProps) {
  const [word, setWord] = useState("");
  const [creating, setCreating] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function submit() {
    const normalized = word.trim();
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
      setEvents((current) => ["Card created and dictionary refreshed.", ...current].slice(0, 8));
      await onAfterSuccess?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Cannot create card.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.form}>
      {showDescription ? (
        <>
          <SectionTitle>Bridge create-card flow</SectionTitle>
          <BodyText>
            Submit a word to the Voca API bridge, wait for generation, then refresh the cards manifest.
          </BodyText>
        </>
      ) : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setWord}
        placeholder="water pooling"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={word}
      />
      <PrimaryButton disabled={!word.trim() || creating} label={creating ? "Creating..." : "Generate card"} onPress={submit} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {events.map((event, index) => (
        <Text key={`${event}-${index}`} style={styles.event}>
          {event}
        </Text>
      ))}
    </View>
  );
}

async function createCardInBackground(word: string, onAfterSuccess?: () => void | Promise<void>) {
  try {
    await createCard(word, () => undefined);
    await refreshCards();
    await onAfterSuccess?.();
  } catch (error) {
    await logClientError(error, "add-voca-background");
  }
}

type AddVocaModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
};

export function AddVocaModal({ visible, onClose, onCreated }: AddVocaModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalCenter}
        >
          <View
            style={[
              styles.modalCard,
              { paddingBottom: Math.max(insets.bottom, spacing.md) },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Voca</Text>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={onClose} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.modalScroll}
            >
              <Text style={styles.modalHint}>
                Submit a word to generate a card via the Voca bridge.
              </Text>
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

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
  event: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 20, 17, 0.48)",
  },
  modalCenter: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "85%",
    zIndex: 1,
  },
  modalCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.panel,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  modalScroll: {
    maxHeight: 420,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  modalClose: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  modalCloseText: {
    color: colors.accentStrong,
    fontSize: 15,
    fontWeight: "800",
  },
  modalHint: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
});
