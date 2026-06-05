import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { parseManifest, type Card } from "@voca/core/data/schema";
import { authHeaders, llmSettingsPayload, loadApiSettings, normalizeBaseUrl } from "./settings";
import { markCardsCloudSyncTrust } from "./cards-cloud-trust";
import { withRetry } from "./retry";
import { getAppGroupDirectory, indexSearchableItems } from "../modules/voca-native";

const cardsCacheKey = "voca.cards.cache";
const pendingLevelUpdatesKey = "voca.cards.pendingLevelUpdates";
const customAgentCardsKey = "voca.agent.customCards";
const imageCacheDir = new Directory(Paths.document, "voca-card-images");

export type MobileCard = Card & {
  id: string;
  imageUrl: string;
  audioUrl: string;
  updatedAt?: string;
};

export type CardsSnapshot = {
  manifestVersion: string;
  cards: MobileCard[];
  updatedAt: string;
};

type PendingLevelUpdate = {
  cardId: string;
  level: MobileCard["level"];
  updatedAt: string;
};

type CardsResponse = {
  manifestVersion?: string;
  cards?: Array<Record<string, unknown>>;
};

function withMobileFields(rawCards: Array<Record<string, unknown>>, parsedCards: Card[]): MobileCard[] {
  return parsedCards.map((card, index) => {
    const raw = rawCards[index] || {};
    const id = String(raw.id || card.slug);
    return {
      ...card,
      id,
      imageUrl: String(raw.imageUrl || `/v1/assets/cards/${encodeURIComponent(card.file)}`),
      audioUrl: String(raw.audioUrl || `/v1/audio/${encodeURIComponent(id)}`),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    };
  });
}

function normalizeCardsResponse(payload: CardsResponse): CardsSnapshot {
  const rawCards = Array.isArray(payload.cards) ? payload.cards : [];
  const parsed = parseManifest(rawCards).cards;
  return {
    manifestVersion: payload.manifestVersion || parseManifest(rawCards).signature,
    cards: withMobileFields(rawCards, parsed),
    updatedAt: new Date().toISOString(),
  };
}

export async function loadCachedCards(): Promise<CardsSnapshot | null> {
  const raw = await AsyncStorage.getItem(cardsCacheKey);
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as CardsSnapshot;
    
    // Auto-restore cards.json to shared App Group if missing
    try {
      let appGroupDir = getAppGroupDirectory();
      if (appGroupDir) {
        if (!appGroupDir.startsWith("file://")) {
          appGroupDir = `file://${appGroupDir}`;
        }
        const sharedDir = new Directory(appGroupDir);
        const sharedFile = new File(sharedDir, "cards.json");
        if (!sharedFile.exists) {
          sharedDir.create({ idempotent: true });
          const encoder = new TextEncoder();
          const data = encoder.encode(JSON.stringify(snapshot));
          sharedFile.write(data);
        }
      }
    } catch (e) {
      console.warn("Failed to auto-restore cards to App Group:", e);
    }
    
    return snapshot;
  } catch {
    return null;
  }
}

export function indexCardsInSpotlight(cards: MobileCard[]): void {
  try {
    const items = cards.map((card) => ({
      id: card.id,
      word: card.word,
      pronunciation: card.pronunciation || "",
      meaningVi: card.meaningVi || "",
      meaningEn: card.meaningEn || "",
    }));
    indexSearchableItems(items);
  } catch (e) {
    console.warn("Failed to index cards in Spotlight:", e);
  }
}

export async function saveCardsSnapshot(snapshot: CardsSnapshot): Promise<void> {
  await AsyncStorage.setItem(cardsCacheKey, JSON.stringify(snapshot));

  // Sync cards to shared App Group for iOS extensions (Widget / Share)
  try {
    let appGroupDir = getAppGroupDirectory();
    if (appGroupDir) {
      if (!appGroupDir.startsWith("file://")) {
        appGroupDir = `file://${appGroupDir}`;
      }
      const sharedDir = new Directory(appGroupDir);
      sharedDir.create({ idempotent: true });
      
      const sharedFile = new File(sharedDir, "cards.json");
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(snapshot));
      sharedFile.write(data);
    }
  } catch (e) {
    console.warn("Failed to write cards to shared App Group:", e);
  }

  // Index cards in system Spotlight search
  indexCardsInSpotlight(snapshot.cards);
}

export async function loadPendingLevelUpdates(): Promise<PendingLevelUpdate[]> {
  const raw = await AsyncStorage.getItem(pendingLevelUpdatesKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingLevelUpdates(updates: PendingLevelUpdate[]): Promise<void> {
  await AsyncStorage.setItem(pendingLevelUpdatesKey, JSON.stringify(updates));
}

async function queueLevelUpdate(cardId: string, level: MobileCard["level"]): Promise<void> {
  const current = await loadPendingLevelUpdates();
  const next = [
    { cardId, level, updatedAt: new Date().toISOString() },
    ...current.filter((update) => update.cardId !== cardId),
  ];
  await savePendingLevelUpdates(next);
}

async function updateCachedCardLevel(cardId: string, level: MobileCard["level"], manifestVersion?: string): Promise<CardsSnapshot | null> {
  const cached = await loadCachedCards();
  if (!cached) return null;
  const next: CardsSnapshot = {
    ...cached,
    manifestVersion: manifestVersion || cached.manifestVersion,
    updatedAt: new Date().toISOString(),
    cards: cached.cards.map((card) => (card.id === cardId || card.slug === cardId ? { ...card, level } : card)),
  };
  await saveCardsSnapshot(next);
  return next;
}

export async function loadCachedCard(cardId: string): Promise<MobileCard | null> {
  const cached = await loadCachedCards();
  return cached?.cards.find((card) => card.id === cardId || card.slug === cardId || card.word.toLowerCase() === cardId.toLowerCase()) || null;
}

export async function loadCustomAgentCardIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(customAgentCardsKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function saveCustomAgentCardIds(cardIds: string[]): Promise<void> {
  const unique = Array.from(new Set(cardIds.filter(Boolean)));
  await AsyncStorage.setItem(customAgentCardsKey, JSON.stringify(unique));
}

export async function toggleCustomAgentCard(cardId: string): Promise<string[]> {
  const current = await loadCustomAgentCardIds();
  const next = current.includes(cardId) ? current.filter((id) => id !== cardId) : [cardId, ...current];
  await saveCustomAgentCardIds(next);
  return next;
}

export async function refreshCards(): Promise<CardsSnapshot> {
  const settings = await loadApiSettings();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error("Configure Voca API base URL in Settings.");

  const cached = await loadCachedCards();
  const url = cached?.manifestVersion
    ? `${baseUrl}/v1/cards?ifChangedSince=${encodeURIComponent(cached.manifestVersion)}`
    : `${baseUrl}/v1/cards`;
  const response = await withRetry(() =>
    fetch(url, {
      headers: authHeaders(settings.token),
    }),
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Cards refresh failed (${response.status})`;
    throw new Error(message);
  }
  if (payload.status === "not_modified" && cached) {
    await saveCardsSnapshot(cached);
    await markCardsCloudSyncTrust();
    return { ...cached, updatedAt: new Date().toISOString() };
  }

  const snapshot = normalizeCardsResponse(payload);
  await saveCardsSnapshot(snapshot);
  await markCardsCloudSyncTrust();
  return snapshot;
}

export async function flushPendingLevelUpdates(): Promise<void> {
  const updates = await loadPendingLevelUpdates();
  if (!updates.length) return;
  const remaining: PendingLevelUpdate[] = [];
  for (const update of updates.reverse()) {
    try {
      await withRetry(() => patchCardLevel(update.cardId, update.level, false), { attempts: 2 });
    } catch {
      remaining.push(update);
    }
  }
  await savePendingLevelUpdates(remaining.reverse());
}

async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await loadApiSettings();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error("Configure Voca API base URL in Settings.");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...authHeaders(settings.token),
      ...(init.headers || {}),
    },
  });
}

export async function patchCardLevel(cardId: string, level: MobileCard["level"], queueOnFailure = true): Promise<MobileCard | null> {
  await updateCachedCardLevel(cardId, level);
  try {
    const response = await withRetry(() =>
      apiRequest(`/v1/cards/${encodeURIComponent(cardId)}/level`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      }),
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `Level update failed (${response.status})`;
      throw new Error(message);
    }
    if (payload.card) {
      await updateCachedCardLevel(cardId, payload.card.level, payload.manifestVersion);
      return payload.card;
    }
    return loadCachedCard(cardId);
  } catch (error) {
    if (queueOnFailure) await queueLevelUpdate(cardId, level);
    throw error;
  }
}

export async function absoluteApiUrl(relativeOrAbsoluteUrl: string): Promise<string> {
  if (/^https?:\/\//i.test(relativeOrAbsoluteUrl)) return relativeOrAbsoluteUrl;
  const settings = await loadApiSettings();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error("Configure Voca API base URL in Settings.");
  return `${baseUrl}${relativeOrAbsoluteUrl.startsWith("/") ? "" : "/"}${relativeOrAbsoluteUrl}`;
}

export async function cardImageUri(card: MobileCard): Promise<string> {
  const settings = await loadApiSettings();
  const imageUrl = await absoluteApiUrl(card.imageUrl);
  const token = settings.token.trim();
  const fileName = `${card.id}-${card.file}`.replace(/[^a-z0-9._-]+/gi, "_");
  imageCacheDir.create({ idempotent: true, intermediates: true });
  const file = new File(imageCacheDir, fileName);
  if (file.exists) return file.uri;
  const downloaded = await File.downloadFileAsync(imageUrl, file, {
    headers: authHeaders(token),
    idempotent: true,
  });
  return downloaded.uri;
}

export function clearCardImageCache(): void {
  if (imageCacheDir.exists) imageCacheDir.delete();
}

export type CreateCardEvent = {
  type?: string;
  message?: string;
  copied?: unknown[];
  skipped?: unknown[];
};

export async function createCard(word: string, onEvent: (event: CreateCardEvent) => void): Promise<void> {
  const settings = await loadApiSettings();
  const response = await apiRequest("/v1/cards/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, settings: llmSettingsPayload(settings) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || `Create card failed (${response.status})`);
  }
  if (!response.body) {
    onEvent({ type: "done", message: "Card created." });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as CreateCardEvent;
      onEvent(event);
      if (event.type === "error") throw new Error(event.message || "Cannot create card.");
    }
  }
  const tail = buffer.trim();
  if (tail) onEvent(JSON.parse(tail) as CreateCardEvent);
}
