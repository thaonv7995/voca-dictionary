import AsyncStorage from "@react-native-async-storage/async-storage";

const errorLogKey = "voca.errorLog";

export type ClientErrorLog = {
  message: string;
  stack?: string;
  route?: string;
  createdAt: string;
};

export async function logClientError(error: unknown, route?: string): Promise<void> {
  const entry: ClientErrorLog = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    route,
    createdAt: new Date().toISOString(),
  };
  const current = await loadClientErrors();
  await AsyncStorage.setItem(errorLogKey, JSON.stringify([entry, ...current].slice(0, 50)));
}

export async function loadClientErrors(): Promise<ClientErrorLog[]> {
  const raw = await AsyncStorage.getItem(errorLogKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function clearClientErrors(): Promise<void> {
  await AsyncStorage.removeItem(errorLogKey);
}
