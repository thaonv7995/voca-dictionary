import { normalizeAnswer } from "@voca/core/practice/utils";
import type { PracticeAttempt } from "@voca/core/practice/types";

const practiceAttemptsStorageKey = "voca.practice.attempts";
const practiceAttemptsLimit = 300;

function readAttempts(): PracticeAttempt[] {
  try {
    const raw = window.localStorage.getItem(practiceAttemptsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAttempts(attempts: PracticeAttempt[]) {
  try {
    window.localStorage.setItem(practiceAttemptsStorageKey, JSON.stringify(attempts.slice(0, practiceAttemptsLimit)));
  } catch {
    // Practice tracking is optional; never block the user flow.
  }
}

export function recordPracticeAttempt(attempt: Omit<PracticeAttempt, "id" | "correct" | "createdAt"> & { correct?: boolean }) {
  if (typeof window === "undefined") return;
  const correct = attempt.correct ?? normalizeAnswer(attempt.userAnswer) === normalizeAnswer(attempt.correctAnswer);
  const next: PracticeAttempt = {
    ...attempt,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    correct,
    createdAt: new Date().toISOString(),
  };
  writeAttempts([next, ...readAttempts()]);
}

export function recentWrongPracticeAttempts(limit = 12): PracticeAttempt[] {
  if (typeof window === "undefined") return [];
  return readAttempts().filter((attempt) => !attempt.correct).slice(0, limit);
}

export function practiceWeaknessPrompt(limit = 8): string {
  const wrongAttempts = recentWrongPracticeAttempts(limit);
  if (!wrongAttempts.length) return "No recorded practice mistakes yet.";
  return [
    "Recent user mistakes to consider without repeating exact prompts:",
    ...wrongAttempts.map((attempt) =>
      [
        `- ${attempt.mode}`,
        attempt.kind ? `kind=${attempt.kind}` : "",
        attempt.trapType ? `trap=${attempt.trapType}` : "",
        `target=${attempt.targetWord}`,
        `wrong=${attempt.userAnswer || "(blank)"}`,
        `correct=${attempt.correctAnswer}`,
      ]
        .filter(Boolean)
        .join("; "),
    ),
  ].join("\n");
}
