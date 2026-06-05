import type { Card } from "./schema";

export type CreatedDateFilter = "all" | "today" | "yesterday" | "last7" | "last30" | "older30" | "noDate";

export type Filters = {
  query: string;
  topic: string;
  partOfSpeech: string;
  createdDate: CreatedDateFilter;
};

type FilterKey = "topic" | "partOfSpeech";

const topicKeywordGroups: Array<[string, string[]]> = [
  ["Business", ["business", "company", "corporate", "policy", "competition", "project", "acquisition", "asset"]],
  ["Office", ["office", "workplace", "meeting", "memo", "email", "equipment", "public information"]],
  ["HR", ["hr", "human resources", "personnel", "job", "employee", "interview", "recruit", "staff", "skills"]],
  ["Travel", ["travel", "hotel", "tour", "airport", "flight", "reservation", "transportation", "port"]],
  ["Marketing", ["marketing", "advertising", "customer", "complaint", "review", "reputation", "brand"]],
  ["Health", ["health", "medical", "safety", "hospital"]],
  ["Legal", ["legal", "contract", "law", "court", "compliance"]],
  ["Finance", ["finance", "money", "bank", "budget", "payment", "invoice", "accounting"]],
  ["Tech", ["tech", "technology", "software", "computer", "machine"]],
  ["Food & Drink", ["food", "drink", "restaurant", "hospitality"]],
  ["Construction", ["construction", "road", "building", "facility"]],
  ["Environment", ["environment", "nature", "sustainable"]],
  ["Scheduling", ["schedule", "scheduling", "date", "planning"]],
];

const topicAliases = new Map([
  ["hr", "HR"],
  ["tech", "Tech"],
  ["it", "Tech"],
  ["general", "General"],
  ["business", "Business"],
  ["office", "Office"],
  ["travel", "Travel"],
  ["marketing", "Marketing"],
  ["health", "Health"],
  ["legal", "Legal"],
  ["finance", "Finance"],
]);

const partOfSpeechLabels = new Map([
  ["noun", "Noun"],
  ["verb", "Verb"],
  ["adjective", "Adjective"],
  ["adverb", "Adverb"],
  ["phrasal verb", "Phrasal verb"],
  ["idiom", "Idiom"],
  ["preposition", "Preposition"],
  ["conjunction", "Conjunction"],
  ["pronoun", "Pronoun"],
  ["determiner", "Determiner"],
  ["gerund", "Gerund"],
  ["phrase", "Phrase"],
  ["other", "Other"],
  ["unknown", "Unknown"],
]);

const partOfSpeechOrder = [
  "Noun",
  "Verb",
  "Adjective",
  "Adverb",
  "Phrasal verb",
  "Idiom",
  "Preposition",
  "Conjunction",
  "Pronoun",
  "Determiner",
  "Gerund",
  "Phrase",
  "Other",
  "Unknown",
];

export function normalizeFilterValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function canonicalTopic(value: string): string {
  const cleaned = normalizeFilterValue(value.replace(/^toeic:\s*/i, ""));
  if (!cleaned) return "Uncategorized";

  const alias = topicAliases.get(cleaned);
  if (alias) return alias;

  for (const [label, keywords] of topicKeywordGroups) {
    if (keywords.some((keyword) => cleaned.includes(keyword))) return label;
  }

  return cleaned.length > 34 ? "General" : titleCase(cleaned);
}

export function canonicalPartOfSpeech(value: string): string {
  const cleaned = normalizeFilterValue(value.replace(/\([^)]*\)/g, ""));
  if (!cleaned) return "Unknown";
  if (cleaned.includes("phrasal verb")) return "Phrasal verb";
  if (cleaned.includes("idiom")) return "Idiom";

  const matches: string[] = [];
  if (/\bnoun\b/.test(cleaned) || cleaned.includes("plural noun")) matches.push("Noun");
  if (/\bverb\b/.test(cleaned) || cleaned.includes("past participle")) matches.push("Verb");
  if (cleaned.includes("adjective")) matches.push("Adjective");
  if (cleaned.includes("adverb")) matches.push("Adverb");
  if (cleaned.includes("preposition")) matches.push("Preposition");
  if (cleaned.includes("conjunction")) matches.push("Conjunction");
  if (cleaned.includes("pronoun")) matches.push("Pronoun");
  if (cleaned.includes("determiner")) matches.push("Determiner");
  if (cleaned.includes("gerund") || cleaned.includes("verb-ing")) matches.push("Gerund");
  if (cleaned.includes("phrase")) matches.push("Phrase");

  if (matches.length) return [...new Set(matches)].join(" / ");
  return partOfSpeechLabels.get(cleaned) || titleCase(cleaned);
}

export function isoDateDaysAgo(daysAgo: number, timeZone = "Asia/Ho_Chi_Minh"): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function createdDateOnly(value?: string): string {
  return String(value || "").slice(0, 10);
}

export function createdDateFilterLabel(filter: CreatedDateFilter): string {
  switch (filter) {
    case "all":
      return "All dates";
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "last7":
      return "Last 7 days";
    case "last30":
      return "Last 30 days";
    case "older30":
      return `Older than 30 days`;
    case "noDate":
      return "No created date";
  }
}

export function isCardInCreatedDateFilter(card: Pick<Card, "createdAt">, filter: CreatedDateFilter): boolean {
  if (filter === "all") return true;
  const createdDate = createdDateOnly(card.createdAt);
  if (!createdDate) return filter === "noDate";

  const today = isoDateDaysAgo(0);
  const yesterday = isoDateDaysAgo(1);
  const last7Start = isoDateDaysAgo(6);
  const last30Start = isoDateDaysAgo(29);

  switch (filter) {
    case "today":
      return createdDate === today;
    case "yesterday":
      return createdDate === yesterday;
    case "last7":
      return createdDate >= last7Start && createdDate <= today;
    case "last30":
      return createdDate >= last30Start && createdDate <= today;
    case "older30":
      return createdDate < last30Start;
    case "noDate":
      return false;
  }
}

export function filterCards(cards: Card[], filters: Filters): Card[] {
  const query = normalizeFilterValue(filters.query);
  return cards.filter((card) => {
    const queryOk = !query || card.word.toLowerCase().includes(query);
    const topicOk = filters.topic === "all" || canonicalTopic(card.topic) === filters.topic;
    const posOk = filters.partOfSpeech === "all" || canonicalPartOfSpeech(card.partOfSpeech) === filters.partOfSpeech;
    const dateOk = isCardInCreatedDateFilter(card, filters.createdDate);
    return queryOk && topicOk && posOk && dateOk;
  });
}

function canonicalValue(card: Card, key: FilterKey): string {
  return key === "topic" ? canonicalTopic(card.topic) : canonicalPartOfSpeech(card.partOfSpeech);
}

export function uniqueSortedValues(cards: Card[], key: FilterKey): string[] {
  const values = [...new Set(cards.map((card) => canonicalValue(card, key)).filter(Boolean))];
  if (key === "partOfSpeech") {
    return values.sort((a, b) => {
      const rankA = partOfSpeechOrder.indexOf(a);
      const rankB = partOfSpeechOrder.indexOf(b);
      if (rankA !== -1 || rankB !== -1) return (rankA === -1 ? 999 : rankA) - (rankB === -1 ? 999 : rankB);
      return a.localeCompare(b);
    });
  }
  return values.sort((a, b) => a.localeCompare(b));
}
