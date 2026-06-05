import { DEFAULT_VOCA_API_TOKEN } from "@voca/core/auth/token";

export const DEFAULT_LOCAL_BRIDGE_ORIGIN =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_LOCAL_BRIDGE_ORIGIN?.trim()
    ? String(import.meta.env.VITE_LOCAL_BRIDGE_ORIGIN).replace(/\/+$/, "")
    : "http://127.0.0.1:22053";

export function resolvedLocalBridgeOrigin(stored?: string): string {
  const trimmed = stored?.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_LOCAL_BRIDGE_ORIGIN;
}

export function bridgeUrl(origin: string, pathname: string): string {
  const base = origin.replace(/\/+$/, "");
  const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${suffix}`;
}

export function bridgeAuthorizationHeader(token?: string): HeadersInit {
  const trimmed = token?.trim() || defaultVocaApiToken();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

export function defaultVocaApiToken(): string {
  return (
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_VOCA_API_TOKEN?.trim()
      ? String(import.meta.env.VITE_VOCA_API_TOKEN).trim()
      : "") || DEFAULT_VOCA_API_TOKEN
  );
}

/** Persist level to cards.json via the Voca bridge so mobile/other clients see the same state. */
export async function patchBridgeCardLevel(
  bridgeOrigin: string,
  cardId: string,
  level: "new" | "learning" | "known" | "mastered",
  options?: { authToken?: string },
): Promise<void> {
  const base = bridgeOrigin.replace(/\/+$/, "");
  const url = `${base}/v1/cards/${encodeURIComponent(cardId)}/level`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...bridgeAuthorizationHeader(options?.authToken),
    },
    body: JSON.stringify({ level }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(payload?.error?.message || `PATCH ${response.status}`);
  }
}
