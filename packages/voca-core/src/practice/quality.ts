import { normalizeAnswer } from "./utils";
import type { ArticlePractice, ChallengeDrill, QuickQuiz, ReadingContext } from "./types";

export type PracticeQualityReport = {
  score: number;
  issues: string[];
};

function scoreFromIssues(issues: string[]): number {
  return Math.max(1, 5 - issues.length);
}

export function assessDrillQuality(drill: ChallengeDrill): PracticeQualityReport {
  const issues: string[] = [];
  const expectedChoiceCount = drill.kind === "part2_response" ? 3 : 4;
  const normalizedChoices = drill.choices.map(normalizeAnswer);

  if (drill.choices.length !== expectedChoiceCount) issues.push("wrong choice count");
  if (!normalizedChoices.includes(normalizeAnswer(drill.answer))) issues.push("answer missing from choices");
  if (new Set(normalizedChoices).size !== normalizedChoices.length) issues.push("duplicate choices");
  if (!drill.trapType) issues.push("missing trapType");
  if (!drill.targetWord) issues.push("missing targetWord");
  if (!drill.testedSkill) issues.push("missing testedSkill");
  if (!drill.difficulty) issues.push("missing difficulty");
  if (drill.scenario.length < 24) issues.push("scenario too short");
  if (drill.explanation.length < 60) issues.push("explanation too thin");
  if (!drill.whyWrong || Object.keys(drill.whyWrong).length < Math.max(1, expectedChoiceCount - 2)) issues.push("weak whyWrong coverage");
  if (/^(what does|define|definition of)\b/i.test(drill.scenario.trim())) issues.push("dictionary-style prompt");

  return { score: scoreFromIssues(issues), issues };
}

export function assessDrillBatchQuality(drills: ChallengeDrill[]): PracticeQualityReport {
  const issues: string[] = [];
  if (!drills.length) issues.push("empty drill batch");
  const seenAnswers = new Set<string>();
  const seenPrompts = new Set<string>();

  for (const drill of drills) {
    const report = assessDrillQuality(drill);
    issues.push(...report.issues.map((issue) => `${drill.answer || "unknown"}: ${issue}`));
    const answerKey = normalizeAnswer(drill.answer);
    const promptKey = normalizeAnswer(drill.scenario);
    if (seenAnswers.has(answerKey)) issues.push(`repeated answer: ${drill.answer}`);
    if (seenPrompts.has(promptKey)) issues.push(`repeated prompt: ${drill.scenario}`);
    seenAnswers.add(answerKey);
    seenPrompts.add(promptKey);
  }

  return { score: scoreFromIssues(issues.slice(0, 5)), issues };
}

export function assessQuickQuizQuality(quiz: QuickQuiz): PracticeQualityReport {
  const issues: string[] = [];
  if (!quiz.questions.length) issues.push("empty quiz");
  for (const question of quiz.questions) {
    if (question.prompt.length < 16) issues.push("question prompt too short");
    if (!question.answer.trim()) issues.push("missing answer");
    if (question.choices?.length && !question.choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(question.answer))) {
      issues.push("answer missing from quiz choices");
    }
  }
  return { score: scoreFromIssues(issues), issues };
}

export function assessReadingQuality(context: ReadingContext): PracticeQualityReport {
  const issues: string[] = [];
  const passageLength = context.documents?.length
    ? context.documents.reduce((total, document) => total + document.passage.length, 0)
    : context.passage.length;

  if (passageLength < (context.format === "part7" ? 8 : 4)) issues.push("passage too short");
  if (context.format === "part7" && !context.documents?.length) issues.push("Part 7 should include document structure");
  if (!context.questions.length) issues.push("missing questions");
  if (context.format === "part7" && context.questions.length < 2) issues.push("too few Part 7 questions");
  if (context.format === "part7" && context.questions.length < 3) issues.push("Part 7 practice should usually have at least 3 questions");
  if (!context.targetWords?.length) issues.push("missing targetWords");

  for (const question of context.questions) {
    if (question.choices.length !== 4) issues.push("question has wrong choice count");
    if (!question.choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(question.answer))) {
      issues.push("answer missing from reading choices");
    }
    if (question.explanation.length < 40) issues.push("reading explanation too thin");
  }

  return { score: scoreFromIssues(issues.slice(0, 5)), issues };
}

export function assessArticlePracticeQuality(article: ArticlePractice): PracticeQualityReport {
  const issues: string[] = [];
  if (article.passage.length < 8) issues.push("article passage too short");
  if (article.targetWords.length < 3) issues.push("too few target words");
  if (article.questions.length < 3) issues.push("too few article questions");
  if (article.vocabularyNotes.length < Math.min(3, article.targetWords.length)) issues.push("too few vocabulary notes");

  for (const question of article.questions) {
    if (question.choices.length !== 4) issues.push("article question has wrong choice count");
    if (!question.choices.some((choice) => normalizeAnswer(choice) === normalizeAnswer(question.answer))) {
      issues.push("answer missing from article choices");
    }
    if (question.explanation.length < 40) issues.push("article explanation too thin");
  }

  return { score: scoreFromIssues(issues.slice(0, 5)), issues };
}
