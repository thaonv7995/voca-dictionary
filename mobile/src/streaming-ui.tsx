import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, spacing } from "./theme";
import { Card, PrimaryButton, SectionTitle, BodyText } from "./ui";
import { streamVocaText } from "./streaming";
import { loadCachedCards, loadCustomAgentCardIds } from "./cards";
import { recordPracticeAttempt, type ContextScope } from "./practice";

type ScopeType = ContextScope["type"];

export function StreamingPanel({
  title,
  description,
  path,
  defaultPrompt,
  scopeEnabled = false,
  recordType,
}: {
  title: string;
  description: string;
  path: string;
  defaultPrompt: string;
  scopeEnabled?: boolean;
  recordType?: string;
}) {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("all");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("new");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [topics, setTopics] = useState<string[]>([]);
  const [customCardIds, setCustomCardIds] = useState<string[]>([]);
  const contextScope = useMemo(() => buildContextScope(scopeType, { topic, level, date, cardIds: customCardIds }), [scopeType, topic, level, date, customCardIds]);

  useEffect(() => {
    if (!scopeEnabled) return;
    Promise.all([loadCachedCards(), loadCustomAgentCardIds()])
      .then(([snapshot, ids]) => {
        const nextTopics = Array.from(new Set((snapshot?.cards || []).map((card) => card.topic).filter(Boolean))).sort();
        setTopics(nextTopics.slice(0, 12));
        setTopic(nextTopics[0] || "");
        setCustomCardIds(ids);
      })
      .catch(() => undefined);
  }, [scopeEnabled]);

  async function run() {
    setAnswer("");
    setError("");
    setStreaming(true);
    try {
      const finalText = await streamVocaText(path, { message: prompt, stream: true, contextScope }, (delta) => setAnswer((current) => current + delta));
      if (recordType) {
        await recordPracticeAttempt({ type: recordType, prompt, response: finalText, contextScope });
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Cannot stream response.");
    } finally {
      setStreaming(false);
    }
  }

  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <BodyText>{description}</BodyText>
      {scopeEnabled ? (
        <ScopeSelector
          customCount={customCardIds.length}
          date={date}
          level={level}
          onDateChange={setDate}
          onLevelChange={setLevel}
          onScopeTypeChange={setScopeType}
          onTopicChange={setTopic}
          scopeType={scopeType}
          topic={topic}
          topics={topics}
        />
      ) : null}
      <TextInput multiline onChangeText={setPrompt} style={styles.input} value={prompt} />
      <PrimaryButton disabled={streaming} label={streaming ? "Streaming..." : "Generate"} onPress={run} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {answer ? <StreamResult answer={answer} contextScope={contextScope} prompt={prompt} recordType={recordType} /> : null}
    </Card>
  );
}

export function buildContextScope(type: ScopeType, values: { topic: string; level: string; date?: string; dateFrom?: string; dateTo?: string; cardIds: string[] }): ContextScope {
  if (type === "topic") return { type, topic: values.topic };
  if (type === "level") return { type, level: values.level };
  if (type === "createdDate") return { type, date: values.date, dateFrom: values.dateFrom || values.date, dateTo: values.dateTo || values.date };
  if (type === "custom") return { type, cardIds: values.cardIds };
  return { type };
}

export function ScopeSelector({
  scopeType,
  onScopeTypeChange,
  topics,
  topic,
  onTopicChange,
  level,
  onLevelChange,
  date,
  onDateChange,
  customCount,
}: {
  scopeType: ScopeType;
  onScopeTypeChange: (value: ScopeType) => void;
  topics: string[];
  topic: string;
  onTopicChange: (value: string) => void;
  level: string;
  onLevelChange: (value: string) => void;
  date: string;
  onDateChange: (value: string) => void;
  customCount: number;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const scopes: Array<{ type: ScopeType; label: string }> = [
    { type: "all", label: "All" },
    { type: "today", label: "Today" },
    { type: "topic", label: "Topic" },
    { type: "level", label: "Level" },
    { type: "createdDate", label: "Date" },
    { type: "custom", label: `Custom (${customCount})` },
  ];
  const activeScope = scopes.find((scope) => scope.type === scopeType) || scopes[0];
  const valueLabel = scopeValueLabel(scopeType, { topic, level, date, customCount });
  const valueOptions = scopeValueOptions(scopeType, { topics, topic });
  return (
    <View style={styles.scopeBlock}>
      <View style={styles.scopeHeader}>
        <Text style={styles.scopeEyebrow}>Context</Text>
        <Text numberOfLines={1} style={styles.scopeSummary}>{contextSummary(scopeType, valueLabel)}</Text>
      </View>
      <View style={styles.scopeControls}>
        <Pressable onPress={() => setScopeOpen(true)} style={styles.scopeControl}>
          <View style={styles.scopeControlIcon}>
            <Ionicons color={colors.accentStrong} name="layers-outline" size={16} />
          </View>
          <View style={styles.scopeControlCopy}>
            <Text style={styles.scopeControlLabel}>Scope</Text>
            <Text numberOfLines={1} style={styles.scopeControlValue}>{activeScope.label}</Text>
          </View>
          <Ionicons color={colors.muted} name="chevron-down" size={16} />
        </Pressable>

        {scopeType === "createdDate" ? (
          <View style={styles.scopeControl}>
            <View style={styles.scopeControlIcon}>
              <Ionicons color={colors.accentStrong} name="calendar-outline" size={16} />
            </View>
            <View style={styles.scopeControlCopy}>
              <Text style={styles.scopeControlLabel}>Created</Text>
              <TextInput autoCapitalize="none" onChangeText={onDateChange} placeholder="YYYY-MM-DD" style={styles.inlineInput} value={date} />
            </View>
          </View>
        ) : scopeType === "topic" || scopeType === "level" ? (
          <Pressable onPress={() => setValueOpen(true)} style={styles.scopeControl}>
            <View style={styles.scopeControlIcon}>
              <Ionicons color={colors.accentStrong} name={scopeType === "topic" ? "pricetag-outline" : "stats-chart-outline"} size={16} />
            </View>
            <View style={styles.scopeControlCopy}>
              <Text style={styles.scopeControlLabel}>{scopeType === "topic" ? "Topic" : "Level"}</Text>
              <Text numberOfLines={1} style={styles.scopeControlValue}>{valueLabel}</Text>
            </View>
            <Ionicons color={colors.muted} name="chevron-down" size={16} />
          </Pressable>
        ) : scopeType === "custom" ? (
          <View style={styles.scopeNote}>
            <Ionicons color={colors.accentStrong} name="albums-outline" size={16} />
            <Text style={styles.scopeNoteText}>Using {customCount} selected words from Cards.</Text>
          </View>
        ) : null}
      </View>

      <OptionSheet
        onClose={() => setScopeOpen(false)}
        onSelect={(value) => {
          onScopeTypeChange(value as ScopeType);
          setScopeOpen(false);
        }}
        options={scopes.map((scope) => ({ value: scope.type, label: scope.label }))}
        selected={scopeType}
        title="Choose context"
        visible={scopeOpen}
      />
      <OptionSheet
        onClose={() => setValueOpen(false)}
        onSelect={(value) => {
          if (scopeType === "topic") onTopicChange(value);
          if (scopeType === "level") onLevelChange(value);
          setValueOpen(false);
        }}
        options={valueOptions}
        selected={scopeType === "topic" ? topic : level}
        title={scopeType === "topic" ? "Choose topic" : "Choose level"}
        visible={valueOpen}
      />
    </View>
  );
}

function OptionSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalScrim}>
        <Pressable style={styles.optionSheet}>
          <View style={styles.optionSheetHeader}>
            <Text style={styles.optionSheetTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.optionSheetClose}>
              <Ionicons color={colors.ink} name="close" size={18} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.optionList}>
            {options.map((option) => {
              const active = selected === option.value;
              return (
                <Pressable key={option.value} onPress={() => onSelect(option.value)} style={[styles.optionRow, active && styles.optionRowActive]}>
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{option.label}</Text>
                  {active ? <Ionicons color={colors.accentStrong} name="checkmark-circle" size={18} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function scopeValueLabel(scopeType: ScopeType, values: { topic: string; level: string; date: string; customCount: number }) {
  if (scopeType === "topic") return values.topic || "Choose topic";
  if (scopeType === "level") return levelLabel(values.level);
  if (scopeType === "createdDate") return values.date;
  if (scopeType === "custom") return `${values.customCount} selected`;
  if (scopeType === "today") return "Created today";
  return "All vocabulary";
}

function contextSummary(scopeType: ScopeType, valueLabel: string) {
  if (scopeType === "all") return "All vocabulary";
  if (scopeType === "today") return "Cards created today";
  if (scopeType === "createdDate") return `Created ${valueLabel}`;
  return valueLabel;
}

function scopeValueOptions(scopeType: ScopeType, values: { topics: string[]; topic: string }) {
  if (scopeType === "topic") {
    return (values.topics.length ? values.topics : [values.topic].filter(Boolean)).map((topic) => ({ value: topic, label: topic }));
  }
  if (scopeType === "level") {
    return ["new", "learning", "known", "mastered"].map((level) => ({ value: level, label: levelLabel(level) }));
  }
  return [];
}

function levelLabel(level: string) {
  if (level === "new") return "New";
  if (level === "learning") return "Learning";
  if (level === "known") return "Known";
  if (level === "mastered") return "Mastered";
  return level;
}

export function StreamResult({
  answer,
  recordType,
  prompt,
  contextScope,
}: {
  answer: string;
  recordType?: string;
  prompt: string;
  contextScope?: ContextScope;
}) {
  const [selected, setSelected] = useState("");
  const options = useMemo(() => parseQuizOptions(answer), [answer]);

  async function selectOption(option: string) {
    setSelected(option);
    if (recordType && contextScope) {
      await recordPracticeAttempt({ type: recordType, prompt, response: answer, selectedAnswer: option, contextScope });
    }
  }

  return (
    <View style={styles.result}>
      <Text style={styles.answer}>{answer}</Text>
      {options.length ? (
        <View style={styles.quiz}>
          <Text style={styles.quizTitle}>Answer choices</Text>
          {options.map((option) => (
            <Pressable key={option} onPress={() => selectOption(option)} style={[styles.choice, selected === option && styles.choiceActive]}>
              <Text style={[styles.choiceText, selected === option && styles.choiceTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function parseQuizOptions(value: string): string[] {
  const matches = value.match(/(?:^|\n)\s*(?:[A-D][.)]|[1-4][.)])\s+(.+)/g) || [];
  return matches.map((line) => line.replace(/^\s*(?:[A-D][.)]|[1-4][.)])\s+/, "").trim()).filter(Boolean).slice(0, 6);
}

const styles = StyleSheet.create({
  scopeBlock: {
    gap: spacing.sm,
  },
  scopeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  scopeEyebrow: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  scopeSummary: {
    flex: 1,
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "right",
  },
  scopeControls: {
    gap: spacing.sm,
  },
  scopeControl: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.panelSoft,
  },
  scopeControlIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
  },
  scopeControlCopy: {
    flex: 1,
    minWidth: 0,
  },
  scopeControlLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
  },
  scopeControlValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  scopeNote: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.accentSoft,
  },
  scopeNoteText: {
    flex: 1,
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "800",
  },
  inlineInput: {
    height: 28,
    padding: 0,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  modalScrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20, 34, 31, 0.28)",
  },
  optionSheet: {
    maxHeight: "72%",
    gap: spacing.sm,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    backgroundColor: colors.panel,
  },
  optionSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionSheetTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
  },
  optionSheetClose: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.panelSoft,
  },
  optionList: {
    gap: spacing.sm,
  },
  optionRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  optionRowActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  optionLabel: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  optionLabelActive: {
    color: colors.accentStrong,
    fontWeight: "900",
  },
  input: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: spacing.md,
    backgroundColor: colors.panelSoft,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    textAlignVertical: "top",
  },
  smallInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.panelSoft,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  result: {
    gap: spacing.md,
  },
  answer: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
  quiz: {
    gap: spacing.sm,
  },
  quizTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "900",
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.md,
    backgroundColor: colors.panelSoft,
  },
  choiceActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  choiceText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  choiceTextActive: {
    color: colors.accentStrong,
  },
});
