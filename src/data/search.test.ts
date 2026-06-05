import { describe, expect, it } from "vitest";
import { canonicalPartOfSpeech, canonicalTopic, filterCards, isoDateDaysAgo, uniqueSortedValues } from "./search";
import { parseManifest } from "./schema";

const manifest = parseManifest([
  {
    word: "hesitate",
    file: "hesitate.png",
    partOfSpeech: "verb",
    topic: "Business",
    tags: ["toeic", "communication"],
    createdAt: "2026-05-03",
  },
  {
    word: "fertilizer",
    file: "fertilizer.png",
    partOfSpeech: "noun",
    topic: "Agriculture",
    tags: ["supplies"],
    createdAt: "2026-05-02",
  },
]);

describe("filterCards", () => {
  it("matches query against the word itself", () => {
    expect(filterCards(manifest.cards, { query: "hesit", topic: "all", partOfSpeech: "all", createdDate: "all" })).toHaveLength(1);
    expect(filterCards(manifest.cards, { query: "commun", topic: "all", partOfSpeech: "all", createdDate: "all" })).toHaveLength(0);
  });

  it("combines topic and part-of-speech filters", () => {
    expect(filterCards(manifest.cards, { query: "", topic: "Agriculture", partOfSpeech: "Noun", createdDate: "all" })[0].word).toBe(
      "fertilizer",
    );
  });

  it("filters by created date scope", () => {
    expect(filterCards(manifest.cards, { query: "", topic: "all", partOfSpeech: "all", createdDate: "noDate" })).toHaveLength(0);
  });

  it("filters timestamped created dates by their local date portion", () => {
    const today = isoDateDaysAgo(0);
    const parsed = parseManifest([
      {
        word: "timestamped",
        file: "timestamped.png",
        partOfSpeech: "noun",
        topic: "Tech",
        createdAt: `${today}T13:25:18+07:00`,
      },
    ]);
    expect(filterCards(parsed.cards, { query: "", topic: "all", partOfSpeech: "all", createdDate: "today" })).toHaveLength(1);
  });
});

describe("filter option normalization", () => {
  it("canonicalizes noisy topic and part-of-speech values", () => {
    expect(canonicalTopic("emails, customer service, complaints, business communication")).toBe("Business");
    expect(canonicalPartOfSpeech("verb, past tense/past participle; adjective")).toBe("Verb / Adjective");
  });

  it("deduplicates option values by canonical value", () => {
    const parsed = parseManifest([
      { word: "one", file: "one.png", partOfSpeech: "Noun", topic: "Marketing" },
      { word: "two", file: "two.png", partOfSpeech: "noun, plural", topic: "marketing" },
    ]);
    expect(uniqueSortedValues(parsed.cards, "topic")).toEqual(["Marketing"]);
    expect(uniqueSortedValues(parsed.cards, "partOfSpeech")).toEqual(["Noun"]);
  });
});
