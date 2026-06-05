import { parseManifest, type Manifest } from "@voca/core/data/schema";
import { readJson } from "../lib/storage";
import { DEFAULT_LOCAL_BRIDGE_ORIGIN, bridgeAuthorizationHeader, defaultVocaApiToken, resolvedLocalBridgeOrigin } from "../local-bridge";

const SETTINGS_KEY = "voca.ai.settings";

type StoredBridgeSlice = {
  localBridgeOrigin?: string;
  bridgeApiToken?: string;
};

const cacheBust = () => `v=${Date.now()}`;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function readBridgeSlice(): StoredBridgeSlice {
  if (typeof window === "undefined") return {};
  return readJson<StoredBridgeSlice>(SETTINGS_KEY, {});
}

function bridgeOriginForManifest(): string {
  return resolvedLocalBridgeOrigin(readBridgeSlice().localBridgeOrigin) || DEFAULT_LOCAL_BRIDGE_ORIGIN;
}

function bridgeTokenForManifest(): string {
  return String(readBridgeSlice().bridgeApiToken || "").trim() || defaultVocaApiToken();
}

/**
 * Fallback when `/cards.json` is not served: same payload the mobile app uses (bridge reads `cards.json` on disk).
 */
async function fetchManifestFromBridge(): Promise<Manifest | null> {
  const base = bridgeOriginForManifest().replace(/\/+$/, "");
  const token = bridgeTokenForManifest();
  try {
    const response = await fetch(`${base}/v1/cards?${cacheBust()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...bridgeAuthorizationHeader(token || undefined),
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      status?: string;
      manifestVersion?: string;
      version?: string;
      cards?: Array<Record<string, unknown>>;
    };
    if (payload.status === "not_modified") return null;
    const rawCards = Array.isArray(payload.cards) ? payload.cards : [];
    const input =
      payload.version !== undefined ? { version: payload.version, cards: rawCards } : rawCards.length ? rawCards : [];
    const parsed = parseManifest(input);
    const signature =
      typeof payload.manifestVersion === "string" && payload.manifestVersion.length > 0
        ? payload.manifestVersion
        : parsed.signature;
    return { ...parsed, signature };
  } catch {
    return null;
  }
}

async function fetchManifestStatic(): Promise<Manifest | null> {
  const response = await fetch(`/cards.json?${cacheBust()}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Cannot load cards.json (${response.status})`);
  }
  return parseManifest(await response.json());
}

/**
 * Source of truth is the manifest file `cards.json`.
 * Prefer static `/cards.json` (what the dev/preview server serves from disk); if missing or the request fails, use `GET /v1/cards` on the bridge (same file when the API reads the repo).
 */
async function fetchManifestOnce(): Promise<Manifest> {
  let fromStatic: Manifest | null = null;
  try {
    fromStatic = await fetchManifestStatic();
  } catch {
    fromStatic = null;
  }
  if (fromStatic !== null) return fromStatic;

  const fromBridge = await fetchManifestFromBridge();
  if (fromBridge) return fromBridge;

  throw new Error("Cannot load cards.json and bridge /v1/cards is unavailable.");
}

export async function fetchManifest(): Promise<Manifest> {
  let lastError: unknown;
  for (const delay of [0, 120, 360]) {
    if (delay) await wait(delay);
    try {
      return await fetchManifestOnce();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Cannot load manifest");
}

export function imagePath(file: string): string {
  return `/cards/${encodeURIComponent(file)}`;
}
