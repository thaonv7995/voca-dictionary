import { flushPendingLevelUpdates, loadPendingLevelUpdates } from "./cards";
import { flushPracticeAttempts, loadPendingPracticeAttempts } from "./practice";

export type PendingSyncSummary = {
  levelUpdates: number;
  practiceAttempts: number;
  total: number;
};

export async function loadPendingSyncSummary(): Promise<PendingSyncSummary> {
  const [levels, attempts] = await Promise.all([loadPendingLevelUpdates(), loadPendingPracticeAttempts()]);
  return {
    levelUpdates: levels.length,
    practiceAttempts: attempts.length,
    total: levels.length + attempts.length,
  };
}

export async function flushPendingSync(): Promise<PendingSyncSummary> {
  await Promise.allSettled([flushPendingLevelUpdates(), flushPracticeAttempts()]);
  return loadPendingSyncSummary();
}
