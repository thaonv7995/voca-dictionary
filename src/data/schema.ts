import { z } from "zod";
import { visibleTags } from "./tags";

export const cardSchema = z.object({
  word: z.string().min(1),
  slug: z.string().optional(),
  file: z.string().min(1),
  pronunciation: z.string().optional(),
  ipa: z.string().optional(),
  frequency: z.string().optional(),
  meaningEn: z.string().optional(),
  meaningVi: z.string().optional(),
  useCases: z.array(z.string()).optional().catch([]),
  examples: z.array(z.string()).optional().catch([]),
  memoryTip: z.string().optional(),
  toeicTrap: z.string().optional(),
  practicePrompt: z.string().optional(),
  answer: z.string().optional(),
  partOfSpeech: z.string().min(1).catch("unknown"),
  topic: z.string().min(1).catch("uncategorized"),
  tags: z.array(z.string()).catch([]),
  createdAt: z.string().optional(),
  level: z.enum(["new", "learning", "known", "mastered"]).catch("new"),
});

export type Card = z.infer<typeof cardSchema> & {
  slug: string;
  searchText: string;
};

const legacyManifestSchema = z.array(cardSchema);

const versionedManifestSchema = z.object({
  version: z.string().optional(),
  cards: z.array(cardSchema),
});

export type Manifest = {
  version: string;
  cards: Card[];
  source: "legacy" | "versioned";
  signature: string;
};

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "word";
}

function normalizeCard(card: z.infer<typeof cardSchema>): Card {
  const slug = card.slug || slugify(card.word);
  const tags = card.tags || [];
  const searchableTags = visibleTags(tags);
  const pronunciation = card.pronunciation || card.ipa || "";
  return {
    ...card,
    slug,
    tags,
    searchText: [
      card.word,
      slug,
      card.file,
      pronunciation,
      card.partOfSpeech,
      card.topic,
      card.meaningEn || "",
      card.meaningVi || "",
      ...(card.useCases || []),
      ...(card.examples || []),
      card.memoryTip || "",
      card.toeicTrap || "",
      card.createdAt || "",
      card.level,
      ...searchableTags,
    ].join(" ").toLowerCase(),
  };
}

function signatureFor(cards: Card[], version?: string): string {
  if (version) return version;
  return `${cards.length}:${cards.map((card) => card.file).join("|")}`;
}

export function parseManifest(input: unknown): Manifest {
  const versioned = versionedManifestSchema.safeParse(input);
  if (versioned.success) {
    const cards = versioned.data.cards.map(normalizeCard);
    const version = versioned.data.version || signatureFor(cards);
    return {
      version,
      cards,
      source: "versioned",
      signature: signatureFor(cards, version),
    };
  }

  const legacy = legacyManifestSchema.parse(input);
  const cards = legacy.map(normalizeCard);
  const version = signatureFor(cards);
  return {
    version,
    cards,
    source: "legacy",
    signature: version,
  };
}

export function findManifestIssues(cards: Card[], availableFiles?: Set<string>) {
  const words = new Map<string, number>();
  const slugs = new Map<string, number>();
  const files = new Map<string, number>();
  const missingFiles: string[] = [];

  for (const card of cards) {
    const wordKey = card.word.trim().toLowerCase();
    words.set(wordKey, (words.get(wordKey) || 0) + 1);
    slugs.set(card.slug, (slugs.get(card.slug) || 0) + 1);
    files.set(card.file, (files.get(card.file) || 0) + 1);
    if (availableFiles && !availableFiles.has(card.file)) missingFiles.push(card.file);
  }

  const duplicateWords = [...words.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  const duplicateSlugs = [...slugs.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  const duplicateFiles = [...files.entries()].filter(([, count]) => count > 1).map(([value]) => value);

  return {
    duplicateWords,
    duplicateSlugs,
    duplicateFiles,
    missingFiles,
  };
}
