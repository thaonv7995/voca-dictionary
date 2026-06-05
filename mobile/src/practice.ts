import AsyncStorage from "@react-native-async-storage/async-storage";
import { authHeaders, loadApiSettings, normalizeBaseUrl } from "./settings";
import { withRetry } from "./retry";

const practiceAttemptsKey = "voca.practice.pendingAttempts";

export type ContextScope =
  | { type: "all" }
  | { type: "today" }
  | { type: "topic"; topic: string }
  | { type: "level"; level: string }
  | { type: "createdDate"; date?: string; dateFrom?: string; dateTo?: string }
  | { type: "custom"; cardIds: string[] };

export type PracticeAttempt = {
  id: string;
  type: string;
  prompt: string;
  response: string;
  selectedAnswer?: string;
  correctAnswer?: string;
  contextScope?: ContextScope;
  createdAt: string;
};

export async function loadPendingPracticeAttempts(): Promise<PracticeAttempt[]> {
  const raw = await AsyncStorage.getItem(practiceAttemptsKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingPracticeAttempts(attempts: PracticeAttempt[]): Promise<void> {
  await AsyncStorage.setItem(practiceAttemptsKey, JSON.stringify(attempts));
}

export async function recordPracticeAttempt(attempt: Omit<PracticeAttempt, "id" | "createdAt">): Promise<void> {
  const next: PracticeAttempt = {
    ...attempt,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  const current = await loadPendingPracticeAttempts();
  await savePendingPracticeAttempts([next, ...current].slice(0, 200));
  await flushPracticeAttempts().catch(() => undefined);
}

export async function flushPracticeAttempts(): Promise<void> {
  const attempts = await loadPendingPracticeAttempts();
  if (!attempts.length) return;

  const settings = await loadApiSettings();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) return;

  const response = await withRetry(() =>
    fetch(`${baseUrl}/v1/practice/attempts`, {
      method: "POST",
      headers: {
        ...authHeaders(settings.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attempts }),
    }),
  );
  if (!response.ok) throw new Error(`Practice attempt sync failed (${response.status})`);
  await savePendingPracticeAttempts([]);
}
