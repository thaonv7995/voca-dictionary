import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, UIManager, View } from "react-native";
import { isCardInCreatedDateFilter, uniqueSortedValues, type CreatedDateFilter } from "@voca/core/data/search";
import type { MobileCard } from "./cards";
import type { ContextScope } from "./practice";
import { colors, spacing } from "./theme";

type ScopeType = ContextScope["type"];

const customLevelOptions = ["all", "new", "learning", "known", "mastered"];
const customCreatedOptions: Array<{ value: CreatedDateFilter; label: string }> = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "last7", label: "7 days" },
  { value: "last30", label: "30 days" },
];

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function animateNextLayout() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export function CompactContextSelector({
  scopeType,
  onScopeTypeChange,
  topics,
  topic,
  onTopicChange,
  level,
  onLevelChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  cards,
  customCardIds,
  onCustomCardIdsChange,
  customCount,
}: {
  scopeType: ScopeType;
  onScopeTypeChange: (value: ScopeType) => void;
  topics: string[];
  topic: string;
  onTopicChange: (value: string) => void;
  level: string;
  onLevelChange: (value: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  cards: MobileCard[];
  customCardIds: string[];
  onCustomCardIdsChange: (value: string[]) => void;
  customCount: number;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const [customQuery, setCustomQuery] = useState("");
  const [customTopicFilter, setCustomTopicFilter] = useState("all");
  const [customLevelFilter, setCustomLevelFilter] = useState("all");
  const [customCreatedFilter, setCustomCreatedFilter] = useState<CreatedDateFilter>("all");
  const scopes: Array<{ value: ScopeType; label: string }> = [
    { value: "all", label: "All words" },
    { value: "today", label: "Today" },
    { value: "topic", label: "Topic" },
    { value: "level", label: "Status" },
    { value: "createdDate", label: "Created" },
    { value: "custom", label: `Custom (${customCount})` },
  ];
  const valueOptions = contextValueOptions(scopeType, topics, topic);
  const scopeLabel = scopes.find((scope) => scope.value === scopeType)?.label || "All words";
  const valueLabel = contextValueLabel(scopeType, { topic, level, dateFrom, dateTo, customCount });

  return (
    <View style={styles.contextChips}>
      <Pressable onPress={() => { animateNextLayout(); setScopeOpen(true); }} style={styles.contextChip}>
        <Text numberOfLines={1} style={styles.contextChipText}>{scopeLabel}</Text>
      </Pressable>
      {scopeType !== "all" && scopeType !== "today" ? (
        <Pressable onPress={() => { animateNextLayout(); setValueOpen(true); }} style={styles.contextChip}>
          <Text numberOfLines={1} style={styles.contextChipText}>{valueLabel}</Text>
        </Pressable>
      ) : (
        <View style={styles.contextChipMuted}>
          <Text numberOfLines={1} style={styles.contextChipMutedText}>{valueLabel}</Text>
        </View>
      )}
      <ContextPopup
        onClose={() => { animateNextLayout(); setScopeOpen(false); }}
        onSelect={(value) => {
          const nextScope = value as ScopeType;
          animateNextLayout();
          onScopeTypeChange(nextScope);
          setScopeOpen(false);
          if (nextScope !== "all" && nextScope !== "today") {
            if (nextScope === "custom") setCustomQuery("");
            setValueOpen(true);
          }
        }}
        options={scopes}
        selected={scopeType}
        title="Context"
        visible={scopeOpen}
      />
      <ContextPopup
        cards={cards}
        customCardIds={customCardIds}
        customCreatedFilter={customCreatedFilter}
        customLevelFilter={customLevelFilter}
        customQuery={customQuery}
        customTopicFilter={customTopicFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        isDate={scopeType === "createdDate"}
        isCustom={scopeType === "custom"}
        onClose={() => { animateNextLayout(); setValueOpen(false); }}
        onCustomCardIdsChange={onCustomCardIdsChange}
        onCustomCreatedFilterChange={setCustomCreatedFilter}
        onCustomLevelFilterChange={setCustomLevelFilter}
        onCustomQueryChange={setCustomQuery}
        onCustomTopicFilterChange={setCustomTopicFilter}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        onSelect={(value) => {
          if (scopeType === "topic") onTopicChange(value);
          if (scopeType === "level") onLevelChange(value);
          setValueOpen(false);
        }}
        options={valueOptions}
        selected={scopeType === "topic" ? topic : scopeType === "level" ? level : customCardIds.join(",")}
        title={scopeType === "topic" ? "Topic" : scopeType === "level" ? "Status" : scopeType === "custom" ? "Custom words" : "Created range"}
        visible={valueOpen}
      />
    </View>
  );
}

function ContextPopup({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  isDate = false,
  isCustom = false,
  dateFrom = "",
  dateTo = "",
  onDateFromChange,
  onDateToChange,
  cards = [],
  customCardIds = [],
  customQuery = "",
  customTopicFilter = "all",
  customLevelFilter = "all",
  customCreatedFilter = "all",
  onCustomQueryChange,
  onCustomTopicFilterChange,
  onCustomLevelFilterChange,
  onCustomCreatedFilterChange,
  onCustomCardIdsChange,
}: {
  visible: boolean;
  title: string;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  isDate?: boolean;
  isCustom?: boolean;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  cards?: MobileCard[];
  customCardIds?: string[];
  customQuery?: string;
  customTopicFilter?: string;
  customLevelFilter?: string;
  customCreatedFilter?: CreatedDateFilter;
  onCustomQueryChange?: (value: string) => void;
  onCustomTopicFilterChange?: (value: string) => void;
  onCustomLevelFilterChange?: (value: string) => void;
  onCustomCreatedFilterChange?: (value: CreatedDateFilter) => void;
  onCustomCardIdsChange?: (value: string[]) => void;
}) {
  const selectedIds = new Set(customCardIds.map((id) => id.toLowerCase()));
  const normalizedQuery = customQuery.trim().toLowerCase();
  const [customFilterMenu, setCustomFilterMenu] = useState<"topic" | "level" | "created" | null>(null);
  const customTopicOptions = useMemo(() => ["all", ...uniqueSortedValues(cards, "topic").slice(0, 16)], [cards]);
  const customFilterActive = Boolean(normalizedQuery || customTopicFilter !== "all" || customLevelFilter !== "all" || customCreatedFilter !== "all");
  const filteredCards = cards
    .filter((card) => {
      const queryOk = !normalizedQuery || [card.word, card.meaningVi, card.topic, card.level, card.partOfSpeech, ...(card.tags || [])].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      const topicOk = customTopicFilter === "all" || card.topic === customTopicFilter;
      const levelOk = customLevelFilter === "all" || card.level === customLevelFilter;
      const createdOk = isCardInCreatedDateFilter(card, customCreatedFilter);
      return queryOk && topicOk && levelOk && createdOk;
    })
    .slice(0, 80);
  function customCardKeys(card: MobileCard) {
    return [card.id, card.slug, card.word].filter(Boolean);
  }
  function toggleCard(card: MobileCard) {
    const keys = customCardKeys(card);
    const key = keys[0];
    const exists = keys.some((candidate) => customCardIds.some((id) => id.toLowerCase() === candidate.toLowerCase()));
    animateNextLayout();
    const next = exists
      ? customCardIds.filter((id) => !keys.some((candidate) => id.toLowerCase() === candidate.toLowerCase()))
      : [key, ...customCardIds];
    onCustomCardIdsChange?.(next);
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.popupScrim}>
        <Pressable style={styles.contextPopup}>
          <View style={styles.popupHeader}>
            <Text style={styles.popupTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.popupClose}>
              <Ionicons color={colors.ink} name="close" size={18} />
            </Pressable>
          </View>
          {isDate ? (
            <CreatedDatePicker dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={onDateFromChange} onDateToChange={onDateToChange} />
          ) : isCustom ? (
            <View style={styles.customPicker}>
              <View style={styles.customSearchBox}>
                <Ionicons color={colors.muted} name="search" size={16} />
                <TextInput autoCapitalize="none" onChangeText={onCustomQueryChange} placeholder="Search word, meaning, topic..." style={styles.customSearchInput} value={customQuery} />
              </View>
              <CustomFilterToolbar
                activeMenu={customFilterMenu}
                createdFilter={customCreatedFilter}
                levelFilter={customLevelFilter}
                onCreatedChange={(value) => onCustomCreatedFilterChange?.(value)}
                onLevelChange={(value) => onCustomLevelFilterChange?.(value)}
                onMenuChange={setCustomFilterMenu}
                onTopicChange={(value) => onCustomTopicFilterChange?.(value)}
                topicFilter={customTopicFilter}
                topicOptions={customTopicOptions}
              />
              <View style={styles.customPickerMeta}>
                <Text style={styles.popupFieldLabel}>{filteredCards.length} shown · {customCardIds.length} selected</Text>
                <Pressable
                  onPress={() => {
                    animateNextLayout();
                    if (customFilterActive) {
                      onCustomQueryChange?.("");
                      onCustomTopicFilterChange?.("all");
                      onCustomLevelFilterChange?.("all");
                      onCustomCreatedFilterChange?.("all");
                    } else {
                      onCustomCardIdsChange?.([]);
                    }
                  }}
                  style={styles.customClearButton}
                >
                  <Text style={styles.customClearText}>{customFilterActive ? "Clear filters" : "Clear selected"}</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.popupOptions}>
                {filteredCards.length ? filteredCards.map((card) => {
                  const key = card.id || card.slug || card.word;
                  const active = customCardKeys(card).some((candidate) => selectedIds.has(candidate.toLowerCase()));
                  return (
                    <Pressable key={key} onPress={() => toggleCard(card)} style={[styles.customWordOption, active && styles.popupOptionActive]}>
                      <View style={styles.customWordCopy}>
                        <Text style={[styles.popupOptionText, active && styles.popupOptionTextActive]}>{card.word}</Text>
                        <Text numberOfLines={1} style={styles.customWordMeta}>{[card.meaningVi, card.topic, levelLabel(card.level)].filter(Boolean).join(" · ")}</Text>
                      </View>
                      {active ? <Ionicons color={colors.accentStrong} name="checkmark-circle" size={18} /> : <Ionicons color={colors.muted} name="add-circle-outline" size={18} />}
                    </Pressable>
                  );
                }) : (
                  <View style={styles.popupEmptyState}>
                    <Text style={styles.popupEmptyTitle}>{cards.length ? "No matching words" : "No cached words"}</Text>
                    <Text style={styles.popupEmptyText}>{cards.length ? "Try another search term." : "Sync cards first, then reopen Custom words."}</Text>
                  </View>
                )}
              </ScrollView>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.popupOptions}>
              {options.map((option) => {
                const active = selected === option.value;
                return (
                  <Pressable key={option.value} onPress={() => onSelect(option.value)} style={[styles.popupOption, active && styles.popupOptionActive]}>
                    <Text style={[styles.popupOptionText, active && styles.popupOptionTextActive]}>{option.label}</Text>
                    {active ? <Ionicons color={colors.accentStrong} name="checkmark-circle" size={18} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CreatedDatePicker({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const presets = createdDatePresets();
  const activePreset = presets.find((preset) => preset.from === dateFrom && preset.to === dateTo)?.value || "custom";

  function selectPreset(preset: { value: string; from: string; to: string }) {
    animateNextLayout();
    onDateFromChange?.(preset.from);
    onDateToChange?.(preset.to);
    setCustomOpen(preset.value === "custom");
  }

  return (
    <View style={styles.createdPicker}>
      {customOpen || activePreset === "custom" ? (
        <DateRangeCalendar
          dateFrom={dateFrom}
          dateTo={dateTo}
          onBack={() => { animateNextLayout(); setCustomOpen(false); }}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
        />
      ) : (
        <View style={styles.createdPresetList}>
          {presets.map((preset) => {
            const active = activePreset === preset.value;
            return (
              <Pressable key={preset.value} onPress={() => selectPreset(preset)} style={[styles.createdPresetRow, active && styles.createdPresetRowActive]}>
                <View style={styles.createdPresetCopy}>
                  <Text style={[styles.createdPresetTitle, active && styles.createdPresetTitleActive]}>{preset.label}</Text>
                  <Text style={styles.createdPresetSubtitle}>{preset.from === preset.to ? preset.from : `${preset.from} - ${preset.to}`}</Text>
                </View>
                {active ? <Ionicons color={colors.accentStrong} name="checkmark-circle" size={19} /> : null}
              </Pressable>
            );
          })}
          <Pressable onPress={() => { animateNextLayout(); setCustomOpen(true); }} style={styles.createdPresetRow}>
            <View style={styles.createdPresetCopy}>
              <Text style={styles.createdPresetTitle}>Custom range</Text>
              <Text style={styles.createdPresetSubtitle}>{dateRangeLabel(dateFrom, dateTo)}</Text>
            </View>
            <Ionicons color={colors.muted} name="calendar-outline" size={19} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function DateRangeCalendar({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onBack,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  onBack?: () => void;
}) {
  const today = formatDateKey(new Date());
  const initial = parseDateKey(dateFrom || dateTo || today);
  const [monthCursor, setMonthCursor] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const [target, setTarget] = useState<"from" | "to">("from");
  const days = calendarDays(monthCursor);
  const weeks = chunkCalendarWeeks(days);
  const monthLabel = monthCursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function selectDate(value: string) {
    animateNextLayout();
    if (target === "from") {
      onDateFromChange?.(value);
      if (dateTo && value > dateTo) onDateToChange?.(value);
      setTarget("to");
      return;
    }
    onDateToChange?.(value);
    if (dateFrom && value < dateFrom) onDateFromChange?.(value);
  }

  return (
    <View style={styles.calendarBox}>
      <View style={styles.calendarRangeRow}>
        <Pressable onPress={onBack} style={styles.calendarBackButton}>
          <Ionicons color={colors.ink} name="chevron-back" size={18} />
        </Pressable>
        <Pressable onPress={() => { animateNextLayout(); setTarget("from"); }} style={[styles.calendarRangePill, target === "from" && styles.calendarRangePillActive]}>
          <Text style={[styles.calendarRangeLabel, target === "from" && styles.calendarRangeLabelActive]}>From</Text>
          <Text style={[styles.calendarRangeValue, target === "from" && styles.calendarRangeLabelActive]}>{dateFrom || "Pick"}</Text>
        </Pressable>
        <Pressable onPress={() => { animateNextLayout(); setTarget("to"); }} style={[styles.calendarRangePill, target === "to" && styles.calendarRangePillActive]}>
          <Text style={[styles.calendarRangeLabel, target === "to" && styles.calendarRangeLabelActive]}>To</Text>
          <Text style={[styles.calendarRangeValue, target === "to" && styles.calendarRangeLabelActive]}>{dateTo || "Pick"}</Text>
        </Pressable>
      </View>
      <View style={styles.calendarHeader}>
        <View style={styles.calendarHeaderSide}>
          <Pressable onPress={() => { animateNextLayout(); setMonthCursor(addMonths(monthCursor, -1)); }} style={styles.calendarNavButton}>
            <Ionicons color={colors.ink} name="chevron-back" size={18} />
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.calendarMonth}>{monthLabel}</Text>
        <View style={styles.calendarHeaderSideRight}>
          <Pressable onPress={() => { animateNextLayout(); setMonthCursor(addMonths(monthCursor, 1)); }} style={styles.calendarNavButton}>
            <Ionicons color={colors.ink} name="chevron-forward" size={18} />
          </Pressable>
        </View>
      </View>
      <View style={styles.calendarWeekdays}>
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <Text key={`${day}-${index}`} style={styles.calendarWeekday}>{day}</Text>)}
      </View>
      <View style={styles.calendarGrid}>
        {weeks.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.calendarWeekRow}>
            {week.map((day) => {
              const selected = day.key === dateFrom || day.key === dateTo;
              const inRange = Boolean(dateFrom && dateTo && day.key >= minDateKey(dateFrom, dateTo) && day.key <= maxDateKey(dateFrom, dateTo));
              return (
                <Pressable key={day.key} onPress={() => selectDate(day.key)} style={[styles.calendarDay, !day.inMonth && styles.calendarDayMuted]}>
                  <View style={[styles.calendarDayInner, inRange && styles.calendarDayInRange, selected && styles.calendarDaySelected]}>
                    <Text style={[styles.calendarDayText, !day.inMonth && styles.calendarDayTextMuted, selected && styles.calendarDayTextSelected]}>{day.date.getDate()}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function CustomFilterToolbar({
  activeMenu,
  topicOptions,
  topicFilter,
  levelFilter,
  createdFilter,
  onMenuChange,
  onTopicChange,
  onLevelChange,
  onCreatedChange,
}: {
  activeMenu: "topic" | "level" | "created" | null;
  topicOptions: string[];
  topicFilter: string;
  levelFilter: string;
  createdFilter: CreatedDateFilter;
  onMenuChange: (value: "topic" | "level" | "created" | null) => void;
  onTopicChange: (value: string) => void;
  onLevelChange: (value: string) => void;
  onCreatedChange: (value: CreatedDateFilter) => void;
}) {
  const options =
    activeMenu === "topic"
      ? topicOptions.map((value) => ({ value, label: value === "all" ? "All topics" : value }))
      : activeMenu === "level"
        ? customLevelOptions.map((value) => ({ value, label: value === "all" ? "All levels" : levelLabel(value) }))
        : activeMenu === "created"
          ? customCreatedOptions
          : [];
  const selected = activeMenu === "topic" ? topicFilter : activeMenu === "level" ? levelFilter : createdFilter;
  function toggleMenu(value: "topic" | "level" | "created") {
    animateNextLayout();
    onMenuChange(activeMenu === value ? null : value);
  }
  return (
    <View style={styles.customFilterToolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customFilterToolbarRow}>
        <CustomFilterButton active={activeMenu === "topic"} label="Topic" value={topicFilter === "all" ? "All" : topicFilter} onPress={() => toggleMenu("topic")} />
        <CustomFilterButton active={activeMenu === "level"} label="Level" value={levelFilter === "all" ? "All" : levelLabel(levelFilter)} onPress={() => toggleMenu("level")} />
        <CustomFilterButton active={activeMenu === "created"} label="Created" value={customCreatedOptions.find((item) => item.value === createdFilter)?.label || "All"} onPress={() => toggleMenu("created")} />
      </ScrollView>
      {activeMenu ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customFilterMenuRow}>
          {options.map((option) => {
            const active = option.value === selected;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  animateNextLayout();
                  if (activeMenu === "topic") onTopicChange(option.value);
                  if (activeMenu === "level") onLevelChange(option.value);
                  if (activeMenu === "created") onCreatedChange(option.value as CreatedDateFilter);
                }}
                style={[styles.customFilterChip, active && styles.customFilterChipActive]}
              >
                <Text numberOfLines={1} style={[styles.customFilterChipText, active && styles.customFilterChipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function CustomFilterButton({ active, label, value, onPress }: { active: boolean; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.customFilterButton, active && styles.customFilterButtonActive]}>
      <Text style={[styles.customFilterButtonLabel, active && styles.customFilterButtonTextActive]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.customFilterButtonValue, active && styles.customFilterButtonTextActive]}>{value}</Text>
    </Pressable>
  );
}

function contextValueLabel(scopeType: ScopeType, values: { topic: string; level: string; dateFrom: string; dateTo: string; customCount: number }) {
  if (scopeType === "topic") return values.topic || "All topics";
  if (scopeType === "level") return levelLabel(values.level);
  if (scopeType === "createdDate") return dateRangeLabel(values.dateFrom, values.dateTo);
  if (scopeType === "custom") return `${values.customCount} words`;
  if (scopeType === "today") return "Created today";
  return "All vocabulary";
}

function dateRangeLabel(dateFrom: string, dateTo: string) {
  if (dateFrom && dateTo && dateFrom !== dateTo) return `${dateFrom} - ${dateTo}`;
  if (dateFrom || dateTo) return dateFrom || dateTo;
  return "Pick range";
}

function createdDatePresets() {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const last7 = new Date();
  last7.setDate(today.getDate() - 6);
  const last30 = new Date();
  last30.setDate(today.getDate() - 29);
  const todayKey = formatDateKey(today);
  return [
    { value: "today", label: "Today", from: todayKey, to: todayKey },
    { value: "yesterday", label: "Yesterday", from: formatDateKey(yesterday), to: formatDateKey(yesterday) },
    { value: "last7", label: "Last 7 days", from: formatDateKey(last7), to: todayKey },
    { value: "last30", label: "Last 30 days", from: formatDateKey(last30), to: todayKey },
  ];
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function minDateKey(left: string, right: string) {
  return left < right ? left : right;
}

function maxDateKey(left: string, right: string) {
  return left > right ? left : right;
}

function calendarDays(monthCursor: Date) {
  const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date,
      key: formatDateKey(date),
      inMonth: date.getMonth() === monthCursor.getMonth(),
    };
  });
}

function chunkCalendarWeeks(days: ReturnType<typeof calendarDays>) {
  return Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7));
}

function contextValueOptions(scopeType: ScopeType, topics: string[], topic: string) {
  if (scopeType === "topic") return (topics.length ? topics : [topic].filter(Boolean)).map((value) => ({ value, label: value }));
  if (scopeType === "level") {
    return ["new", "learning", "known", "mastered"].map((value) => ({ value, label: levelLabel(value) }));
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

export function applyContextScope(cards: MobileCard[], scope: ContextScope) {
  if (scope.type === "today") return cards.filter((card) => String(card.createdAt || card.updatedAt || "").startsWith(new Date().toISOString().slice(0, 10)));
  if (scope.type === "topic" && scope.topic) return cards.filter((card) => String(card.topic || "").toLowerCase() === scope.topic.toLowerCase());
  if (scope.type === "level" && scope.level) return cards.filter((card) => String(card.level || "").toLowerCase() === scope.level.toLowerCase());
  if (scope.type === "createdDate") return cards.filter((card) => isCardInDateRange(card, scope.dateFrom || scope.date || "", scope.dateTo || scope.date || ""));
  if (scope.type === "custom" && scope.cardIds.length) {
    const ids = new Set(scope.cardIds.map((id) => id.toLowerCase()));
    return cards.filter((card) => ids.has(card.id.toLowerCase()) || ids.has(card.slug.toLowerCase()) || ids.has(card.word.toLowerCase()));
  }
  return cards;
}

export function describeContext(scope: ContextScope, count: number) {
  if (scope.type === "today") return "Cards created today";
  if (scope.type === "topic") return scope.topic || "Topic";
  if (scope.type === "level") return `${scope.level} words`;
  if (scope.type === "createdDate") return `Created ${dateRangeLabel(scope.dateFrom || scope.date || "", scope.dateTo || scope.date || "")}`;
  if (scope.type === "custom") return `${count} selected words`;
  return "All vocabulary";
}

function isCardInDateRange(card: MobileCard, dateFrom: string, dateTo: string) {
  const value = String(card.createdAt || card.updatedAt || "").slice(0, 10);
  const from = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
  const to = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}


export function CompactFormatSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <View style={styles.formatChipRow}>
      <Pressable onPress={() => { animateNextLayout(); setOpen(true); }} style={[styles.contextChip, styles.formatTypeChip]}>
        <Text numberOfLines={1} style={styles.contextChipText}>{selected?.label ?? "Select"}</Text>
      </Pressable>
      <ContextPopup
        onClose={() => { animateNextLayout(); setOpen(false); }}
        onSelect={(next) => {
          onChange(next as T);
          setOpen(false);
        }}
        options={options}
        selected={value}
        title="Type"
        visible={open}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contextChips: { flex: 1, flexDirection: "row", gap: spacing.xs },
  contextChip: { maxWidth: 112, minHeight: 24, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: spacing.sm, backgroundColor: colors.accentSoft },
  contextChipText: { flexShrink: 1, color: colors.accentStrong, fontSize: 11, fontWeight: "900" },
  contextChipMuted: { maxWidth: 112, minHeight: 24, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  contextChipMutedText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  popupScrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20, 34, 31, 0.28)" },
  contextPopup: { maxHeight: "68%", gap: spacing.sm, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xl, backgroundColor: colors.panel },
  popupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  popupTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  popupClose: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: colors.panelSoft },
  popupOptions: { gap: spacing.sm },
  popupOption: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: spacing.md, backgroundColor: colors.panelSoft },
  popupOptionActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  popupOptionText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "800" },
  popupOptionTextActive: { color: colors.accentStrong, fontWeight: "900" },
  popupDateBox: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: spacing.md, backgroundColor: colors.panelSoft },
  popupFieldLabel: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  popupDateInput: { minHeight: 38, color: colors.ink, fontSize: 16, fontWeight: "900" },
  createdPicker: { gap: spacing.sm },
  createdPresetList: { gap: spacing.xs },
  createdPresetRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 15, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.panelSoft },
  createdPresetRowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  createdPresetCopy: { flex: 1, minWidth: 0 },
  createdPresetTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  createdPresetTitleActive: { color: colors.accentStrong },
  createdPresetSubtitle: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  calendarBox: { gap: spacing.sm, borderWidth: 1, borderColor: "#cdd9d4", borderRadius: 18, padding: spacing.md, backgroundColor: colors.panel },
  calendarBackButton: { width: 42, minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.panelSoft },
  calendarRangeRow: { flexDirection: "row", alignItems: "stretch", gap: spacing.xs },
  calendarRangePill: { flex: 1, gap: 2, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.panelSoft },
  calendarRangePillActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  calendarRangeLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  calendarRangeValue: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  calendarRangeLabelActive: { color: colors.accentStrong },
  calendarHeader: { flexDirection: "row", alignItems: "center" },
  calendarHeaderSide: { width: 42, alignItems: "flex-start" },
  calendarHeaderSideRight: { width: 42, alignItems: "flex-end" },
  calendarNavButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 17, backgroundColor: colors.panelSoft },
  calendarMonth: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "900", textAlign: "center" },
  calendarWeekdays: { flexDirection: "row" },
  calendarWeekday: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: "900", textAlign: "center" },
  calendarGrid: { gap: 2 },
  calendarWeekRow: { flexDirection: "row" },
  calendarDay: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  calendarDayInner: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17 },
  calendarDayMuted: { opacity: 0.42 },
  calendarDayInRange: { backgroundColor: colors.accentSoft },
  calendarDaySelected: { backgroundColor: colors.accent },
  calendarDayText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  calendarDayTextMuted: { color: colors.muted },
  calendarDayTextSelected: { color: "#ffffff", fontWeight: "900" },
  customPicker: { minHeight: 360, gap: spacing.sm },
  customSearchBox: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  customSearchInput: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700" },
  customFilterToolbar: { gap: spacing.xs },
  customFilterToolbarRow: { gap: spacing.xs, paddingRight: spacing.md },
  customFilterButton: { width: 104, minHeight: 40, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  customFilterButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  customFilterButtonLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  customFilterButtonValue: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  customFilterButtonTextActive: { color: colors.accentStrong },
  customFilterMenuRow: { gap: spacing.xs, paddingRight: spacing.md },
  customFilterChip: { maxWidth: 132, minHeight: 30, justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: spacing.sm, backgroundColor: colors.panelSoft },
  customFilterChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  customFilterChipText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  customFilterChipTextActive: { color: colors.accentStrong },
  customPickerMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  customClearButton: { minHeight: 28, justifyContent: "center", borderRadius: 14, paddingHorizontal: spacing.sm, backgroundColor: colors.accentSoft },
  customClearText: { color: colors.accentStrong, fontSize: 12, fontWeight: "900" },
  customWordOption: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.panelSoft },
  customWordCopy: { flex: 1, minWidth: 0 },
  customWordMeta: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  popupEmptyState: { gap: spacing.xs, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: spacing.lg, backgroundColor: colors.panelSoft },
  popupEmptyTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  popupEmptyText: { color: colors.muted, fontSize: 12, fontWeight: "700", textAlign: "center" },
  formatChipRow: { width: "100%", flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs },
  formatTypeChip: { maxWidth: "100%", alignSelf: "flex-start" },
});
