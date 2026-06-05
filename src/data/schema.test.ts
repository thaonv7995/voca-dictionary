import { describe, expect, it } from "vitest";
import { findManifestIssues, parseManifest } from "./schema";

describe("parseManifest", () => {
  it("supports legacy array manifests", () => {
    const parsed = parseManifest([{ word: "yield", file: "yield.png", partOfSpeech: "verb", topic: "Finance" }]);
    expect(parsed.source).toBe("legacy");
    expect(parsed.cards[0].slug).toBe("yield");
  });

  it("supports versioned manifests", () => {
    const parsed = parseManifest({
      version: "2026-04-29T13:30:00+07:00",
      cards: [{ word: "go ahead", file: "go-ahead.png", partOfSpeech: "phrase", topic: "Business" }],
    });
    expect(parsed.source).toBe("versioned");
    expect(parsed.version).toBe("2026-04-29T13:30:00+07:00");
  });
});

describe("findManifestIssues", () => {
  it("detects duplicate files and missing files", () => {
    const parsed = parseManifest([
      { word: "one", file: "one.png", partOfSpeech: "noun", topic: "General" },
      { word: "two", file: "one.png", partOfSpeech: "noun", topic: "General" },
    ]);
    const issues = findManifestIssues(parsed.cards, new Set(["two.png"]));
    expect(issues.duplicateFiles).toEqual(["one.png"]);
    expect(issues.missingFiles).toEqual(["one.png", "one.png"]);
  });
});
