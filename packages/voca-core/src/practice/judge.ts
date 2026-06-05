import type { PracticeQualityReport } from "./quality";

export type RevisePracticeKind = "drill_ndjson" | "reading_context" | "article_practice";

export function revisePracticePrompt(kind: RevisePracticeKind, content: string, report: PracticeQualityReport): string {
  const targetShape =
    kind === "drill_ndjson"
      ? "Return NDJSON only. Each line must be one drill object with kind, trapType, targetWord, testedSkill, difficulty, title, instruction, scenario, choices, answer, explanation, and whyWrong."
      : kind === "article_practice"
        ? "Return JSON only using the article_practice schema. Keep type, title, documentType, passage, targetWords, questions, and vocabularyNotes."
        : "Return JSON only using the reading_context schema. Keep type, format, documentType, title, passage or documents, questions, and targetWords.";

  return [
    "You are a TOEIC practice quality judge and reviser.",
    "Revise the draft so it is realistic, grammatically correct, and useful for TOEIC learners.",
    "Fix these quality issues:",
    ...report.issues.slice(0, 10).map((issue) => `- ${issue}`),
    "Requirements:",
    "- Keep correct answers inside choices.",
    "- Use plausible distractors, not obviously unrelated choices.",
    "- Explanations must teach the trap briefly in English with Vietnamese support when useful.",
    "- Do not add markdown or commentary.",
    targetShape,
    "Draft:",
    content,
  ].join("\n");
}
