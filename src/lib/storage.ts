import { useEffect, useState } from "react";

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as T;
    if (
      fallback &&
      parsed &&
      typeof fallback === "object" &&
      typeof parsed === "object" &&
      !Array.isArray(fallback) &&
      !Array.isArray(parsed)
    ) {
      return { ...fallback, ...parsed };
    }

    return parsed;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readJson(key, fallback));

  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}
