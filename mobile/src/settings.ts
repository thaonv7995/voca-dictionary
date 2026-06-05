import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_VOCA_API_TOKEN } from "@voca/core/auth/token";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { clearCardsCloudSyncTrust } from "./cards-cloud-trust";
import { saveSharedSetting } from "../modules/voca-native";

const apiBaseUrlKey = "voca.api.baseUrl";
const apiTokenKey = "voca.api.token";
const llmBaseUrlKey = "voca.llm.baseUrl";
const llmApiKeyKey = "voca.llm.apiKey";
const llmModelKey = "voca.llm.model";
const ttsEndpointKey = "voca.tts.endpoint";
const ttsModelKey = "voca.tts.model";
const conversationVoiceAKey = "voca.conversation.voiceA";
const conversationVoiceBKey = "voca.conversation.voiceB";
const conversationVoiceCKey = "voca.conversation.voiceC";
const conversationAutoSelectVoicesKey = "voca.conversation.autoSelectVoices";
const useApiTtsKey = "voca.tts.useApi";
const audioWifiOnlyKey = "voca.audio.wifiOnly";
const nonStopListeningKey = "voca.listen.nonStop";
const nonStopPreloadCountKey = "voca.listen.nonStopPreloadCount";

export const defaultTtsModel = "edge-tts/en-US-SteffanNeural";
export const defaultConversationVoiceB = "edge-tts/en-US-AvaNeural";
export const defaultConversationVoiceC = "edge-tts/en-US-AndrewNeural";

export const ttsVoiceOptions = [
  { value: "edge-tts/en-US-SteffanNeural", label: "Steffan (US) · M" },
  { value: "edge-tts/en-US-AvaNeural", label: "Ava (US) · F" },
  { value: "edge-tts/en-US-AndrewNeural", label: "Andrew (US) · M" },
  { value: "edge-tts/en-US-EmmaNeural", label: "Emma (US) · F" },
  { value: "edge-tts/en-US-BrianNeural", label: "Brian (US) · M" },
  { value: "edge-tts/en-GB-RyanNeural", label: "Ryan (UK) · M" },
  { value: "edge-tts/en-GB-SoniaNeural", label: "Sonia (UK) · F" },
  { value: "edge-tts/en-GB-LibbyNeural", label: "Libby (UK) · F" },
  { value: "edge-tts/en-AU-WilliamNeural", label: "William (AU) · M" },
  { value: "edge-tts/en-AU-NatashaNeural", label: "Natasha (AU) · F" },
  { value: "edge-tts/en-CA-LiamNeural", label: "Liam (CA) · M" },
  { value: "edge-tts/en-CA-ClaraNeural", label: "Clara (CA) · F" },
  { value: "edge-tts/en-SG-WayneNeural", label: "Wayne (SG) · M" },
  { value: "edge-tts/en-SG-LunaNeural", label: "Luna (SG) · F" },
];

export type ApiSettings = {
  baseUrl: string;
  token: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  ttsEndpoint: string;
  ttsModel: string;
  conversationVoiceA: string;
  conversationVoiceB: string;
  conversationVoiceC: string;
  conversationAutoSelectVoices: boolean;
  useApiTts: boolean;
};

export async function loadAudioWifiOnly(): Promise<boolean> {
  return (await AsyncStorage.getItem(audioWifiOnlyKey)) === "true";
}

export async function saveAudioWifiOnly(value: boolean): Promise<void> {
  await AsyncStorage.setItem(audioWifiOnlyKey, value ? "true" : "false");
}

export async function loadNonStopListeningEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(nonStopListeningKey)) === "true";
}

export async function saveNonStopListeningEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(nonStopListeningKey, value ? "true" : "false");
}

export async function loadNonStopPreloadCount(): Promise<number> {
  const value = Number(await AsyncStorage.getItem(nonStopPreloadCountKey));
  return [1, 2, 3].includes(value) ? value : 1;
}

export async function saveNonStopPreloadCount(value: number): Promise<void> {
  const normalized = [1, 2, 3].includes(value) ? value : 1;
  await AsyncStorage.setItem(nonStopPreloadCountKey, String(normalized));
}

export async function loadApiSettings(): Promise<ApiSettings> {
  const [
    baseUrl,
    token,
    llmBaseUrl,
    llmApiKey,
    llmModel,
    ttsEndpoint,
    ttsModel,
    conversationVoiceA,
    conversationVoiceB,
    conversationVoiceC,
    conversationAutoSelectVoices,
    useApiTts,
  ] = await Promise.all([
    AsyncStorage.getItem(apiBaseUrlKey),
    SecureStore.getItemAsync(apiTokenKey),
    AsyncStorage.getItem(llmBaseUrlKey),
    SecureStore.getItemAsync(llmApiKeyKey),
    AsyncStorage.getItem(llmModelKey),
    AsyncStorage.getItem(ttsEndpointKey),
    AsyncStorage.getItem(ttsModelKey),
    AsyncStorage.getItem(conversationVoiceAKey),
    AsyncStorage.getItem(conversationVoiceBKey),
    AsyncStorage.getItem(conversationVoiceCKey),
    AsyncStorage.getItem(conversationAutoSelectVoicesKey),
    AsyncStorage.getItem(useApiTtsKey),
  ]);
  return {
    baseUrl: baseUrl || defaultApiBaseUrl(),
    token: token || defaultApiToken(),
    llmBaseUrl: llmBaseUrl || defaultLlmBaseUrl(),
    llmApiKey: llmApiKey || defaultLlmApiKey(),
    llmModel: llmModel || defaultLlmModel(),
    ttsEndpoint: ttsEndpoint || defaultTtsEndpoint(),
    ttsModel: ttsModel || defaultTtsModel,
    conversationVoiceA: conversationVoiceA || defaultTtsModel,
    conversationVoiceB: conversationVoiceB || defaultConversationVoiceB,
    conversationVoiceC: conversationVoiceC || defaultConversationVoiceC,
    conversationAutoSelectVoices: conversationAutoSelectVoices !== "false",
    useApiTts: useApiTts !== "false",
  };
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  const prevBase = await AsyncStorage.getItem(apiBaseUrlKey);
  const nextBase = settings.baseUrl.trim();
  if (prevBase !== nextBase) {
    await clearCardsCloudSyncTrust();
  }
  await Promise.all([
    AsyncStorage.setItem(apiBaseUrlKey, settings.baseUrl.trim()),
    AsyncStorage.setItem(llmBaseUrlKey, settings.llmBaseUrl.trim()),
    AsyncStorage.setItem(llmModelKey, settings.llmModel.trim()),
    AsyncStorage.setItem(ttsEndpointKey, settings.ttsEndpoint.trim()),
    AsyncStorage.setItem(ttsModelKey, settings.ttsModel.trim()),
    AsyncStorage.setItem(conversationVoiceAKey, settings.conversationVoiceA.trim()),
    AsyncStorage.setItem(conversationVoiceBKey, settings.conversationVoiceB.trim()),
    AsyncStorage.setItem(conversationVoiceCKey, settings.conversationVoiceC.trim()),
    AsyncStorage.setItem(conversationAutoSelectVoicesKey, settings.conversationAutoSelectVoices ? "true" : "false"),
    AsyncStorage.setItem(useApiTtsKey, settings.useApiTts ? "true" : "false"),
    settings.token.trim()
      ? SecureStore.setItemAsync(apiTokenKey, settings.token.trim())
      : SecureStore.deleteItemAsync(apiTokenKey),
    settings.llmApiKey.trim()
      ? SecureStore.setItemAsync(llmApiKeyKey, settings.llmApiKey.trim())
      : SecureStore.deleteItemAsync(llmApiKeyKey),
  ]);

  // Sync settings to shared App Group for iOS extensions
  try {
    saveSharedSetting("voca.api.baseUrl", settings.baseUrl.trim());
    saveSharedSetting("voca.api.token", settings.token.trim());
  } catch (e) {
    console.warn("Failed to write to shared App Group settings:", e);
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function defaultApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_VOCA_API_BASE_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);

  const hostUri = Constants.expoConfig?.hostUri || Constants.manifest2?.extra?.expoGo?.debuggerHost;
  const host = typeof hostUri === "string" ? hostUri.split(":")[0] : "";
  if (host) return `http://${host}:22053`;

  return "http://127.0.0.1:22053";
}

export function defaultApiToken(): string {
  return process.env.EXPO_PUBLIC_VOCA_API_TOKEN?.trim() || DEFAULT_VOCA_API_TOKEN;
}

export function defaultLlmBaseUrl(): string {
  return process.env.EXPO_PUBLIC_VOCA_LLM_BASE_URL?.trim() || process.env.EXPO_PUBLIC_OPENAI_BASE_URL?.trim() || "";
}

export function defaultLlmApiKey(): string {
  return process.env.EXPO_PUBLIC_VOCA_LLM_API_KEY?.trim() || process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim() || "";
}

export function defaultLlmModel(): string {
  return process.env.EXPO_PUBLIC_VOCA_LLM_MODEL?.trim() || process.env.EXPO_PUBLIC_OPENAI_MODEL?.trim() || "";
}

export function defaultTtsEndpoint(): string {
  return process.env.EXPO_PUBLIC_VOCA_TTS_ENDPOINT?.trim() || "";
}

export function llmSettingsPayload(settings: ApiSettings): { apiKey: string; baseURL: string; model: string } | undefined {
  const apiKey = settings.llmApiKey.trim();
  const baseURL = normalizeBaseUrl(settings.llmBaseUrl);
  const model = settings.llmModel.trim();
  if (!apiKey || !baseURL || !model) return undefined;
  return { apiKey, baseURL, model };
}

export function ttsSettingsPayload(
  settings: ApiSettings,
  ttsModel = settings.ttsModel,
): { apiKey: string; baseURL: string; ttsEndpoint: string; ttsModel: string } | undefined {
  if (!settings.useApiTts) return undefined;
  const apiKey = settings.llmApiKey.trim();
  const baseURL = normalizeBaseUrl(settings.llmBaseUrl);
  const ttsEndpoint = normalizeBaseUrl(settings.ttsEndpoint);
  const model = ttsModel.trim() || defaultTtsModel;
  if (!apiKey || (!baseURL && !ttsEndpoint)) return undefined;
  return { apiKey, baseURL, ttsEndpoint, ttsModel: model };
}

export function authHeaders(token: string): Record<string, string> {
  const trimmed = token.trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

export async function checkApiHealth(settings: ApiSettings): Promise<string> {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error("Enter Voca API base URL first.");

  const response = await fetch(`${baseUrl}/v1/health`, {
    headers: authHeaders(settings.token),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Health check failed (${response.status})`;
    throw new Error(message);
  }
  return payload?.service ? `Connected to ${payload.service}` : "Connected";
}
