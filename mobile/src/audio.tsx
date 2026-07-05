import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import NetInfo from "@react-native-community/netinfo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { absoluteApiUrl, type MobileCard } from "./cards";
import { loadApiSettings, loadAudioWifiOnly, ttsSettingsPayload } from "./settings";
import { PrimaryButton } from "./ui";

const audioCacheDir = new Directory(Paths.document, "voca-audio");

export async function ensureCardAudio(card: MobileCard): Promise<{ uri: string; headers: Record<string, string> }> {
  const settings = await loadApiSettings();
  const token = settings.token.trim();
  const uri = await absoluteApiUrl(card.audioUrl);
  audioCacheDir.create({ idempotent: true, intermediates: true });
  const fileName = `${card.id}.mp3`.replace(/[^a-z0-9._-]+/gi, "_");
  const localFile = new File(audioCacheDir, fileName);
  if (localFile.exists) return { uri: localFile.uri, headers: {} };
  if (await loadAudioWifiOnly()) {
    const network = await NetInfo.fetch();
    if (network.type !== "wifi" && network.type !== "ethernet") {
      throw new Error("Audio download is limited to Wi-Fi in Settings.");
    }
  }

  const response = await fetch(uri, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (response.status === 404) {
    const generated = await fetch(uri, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ settings: ttsSettingsPayload(settings) }),
    });
    const payload = await generated.json().catch(() => ({}));
    if (!generated.ok) {
      throw new Error(payload?.error?.message || `Audio generation failed (${generated.status})`);
    }
  } else if (!response.ok) {
    throw new Error(`Audio request failed (${response.status})`);
  }
  const downloaded = await File.downloadFileAsync(uri, localFile, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    idempotent: true,
  });
  return {
    uri: downloaded.uri,
    headers: {},
  };
}

export async function ensureTextAudio(text: string, voiceModel?: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const cleanText = text.trim();
  if (!cleanText) throw new Error("Missing text.");
  const settings = await loadApiSettings();
  const ttsSettings = ttsSettingsPayload(settings, voiceModel);
  if (!ttsSettings) throw new Error("Configure Voice settings first.");
  if (await loadAudioWifiOnly()) {
    const network = await NetInfo.fetch();
    if (network.type !== "wifi" && network.type !== "ethernet") {
      throw new Error("Audio download is limited to Wi-Fi in Settings.");
    }
  }

  audioCacheDir.create({ idempotent: true, intermediates: true });
  const model = voiceModel || settings.ttsModel;
  const fileName = `conversation-${hashText(`${model}\n${cleanText}`)}.mp3`;
  const localFile = new File(audioCacheDir, fileName);
  if (localFile.exists) return { uri: localFile.uri, headers: {} };

  const endpoint = ttsSettings.ttsEndpoint || `${ttsSettings.baseURL.replace(/\/+$/, "")}/audio/speech`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ttsSettings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: cleanText,
    }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`TTS request failed (${response.status})${message ? `: ${message.slice(0, 180)}` : ""}`);
  }
  localFile.write(new Uint8Array(await response.arrayBuffer()));
  return { uri: localFile.uri, headers: {} };
}

export function ensureSilenceAudio(milliseconds: number): { uri: string; headers: Record<string, string> } {
  audioCacheDir.create({ idempotent: true, intermediates: true });
  const duration = Math.max(100, Math.round(milliseconds));
  const localFile = new File(audioCacheDir, `silence-${duration}.wav`);
  if (!localFile.exists) {
    localFile.write(createSilentWav(duration));
  }
  return { uri: localFile.uri, headers: {} };
}

export function clearAudioCache(): void {
  if (audioCacheDir.exists) audioCacheDir.delete();
}

export function AnimatedAudioWave({ compact = false, color = "#ffffff" }: { compact?: boolean; color?: string }) {
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 760,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => {
      animation.stop();
      wave.setValue(0);
    };
  }, [wave]);

  return (
    <View style={compact ? audioStyles.compactWave : audioStyles.wave}>
      <Animated.View style={[audioStyles.bar, compact && audioStyles.compactBar, { backgroundColor: color }, animatedWaveBar(wave, [0.45, 1.35, 0.7, 0.45])]} />
      <Animated.View style={[audioStyles.bar, compact && audioStyles.compactBar, { backgroundColor: color }, animatedWaveBar(wave, [1.2, 0.55, 1.45, 1.2])]} />
      <Animated.View style={[audioStyles.bar, compact && audioStyles.compactBar, { backgroundColor: color }, animatedWaveBar(wave, [0.7, 1.45, 0.55, 0.7])]} />
    </View>
  );
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function createSilentWav(milliseconds: number): Uint8Array {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.round((sampleRate * milliseconds) / 1000));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function AudioPlayButton({ card }: { card: MobileCard }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function play() {
    setLoading(true);
    setError("");
    try {
      const source = await ensureCardAudio(card);
      player.replace(source);
      player.play();
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Cannot play audio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PrimaryButton disabled={loading} label={status.playing ? "Playing..." : loading ? "Loading audio..." : "Play audio"} onPress={play} />
      {error ? <Text style={{ color: "#b42318", fontSize: 13, fontWeight: "800" }}>{error}</Text> : null}
    </>
  );
}

export function AudioIconButton({ card, showError = true, autoPlayTrigger = false }: { card: MobileCard; showError?: boolean; autoPlayTrigger?: boolean }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (autoPlayTrigger) {
      void play();
    }
  }, [autoPlayTrigger, card.id]);

  async function play() {
    setLoading(true);
    setError("");
    try {
      const source = await ensureCardAudio(card);
      player.replace(source);
      player.play();
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Cannot play audio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={audioStyles.wrap}>
      <Pressable disabled={loading} onPress={play} style={[audioStyles.button, status.playing && audioStyles.buttonActive]}>
        {status.playing ? (
          <AnimatedAudioWave />
        ) : (
          <View style={loading && audioStyles.iconMuted}>
            {loading ? <Text style={audioStyles.loadingText}>...</Text> : <Ionicons color="#0e5648" name="volume-high-outline" size={21} />}
          </View>
        )}
      </Pressable>
      {showError && error ? <Text style={audioStyles.error}>{error}</Text> : null}
    </View>
  );
}

export function TextAudioButton({ text, showError = false }: { text: string; showError?: boolean }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function play() {
    setLoading(true);
    setError("");
    try {
      const source = await ensureTextAudio(text);
      player.replace(source);
      player.play();
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Cannot play audio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={audioStyles.wrap}>
      <Pressable disabled={loading || !text.trim()} onPress={play} style={[audioStyles.compactButton, status.playing && audioStyles.buttonActive]}>
        {status.playing ? (
          <AnimatedAudioWave compact />
        ) : loading ? (
          <Text style={audioStyles.loadingText}>...</Text>
        ) : (
          <Ionicons color="#0e5648" name="volume-high-outline" size={17} />
        )}
      </Pressable>
      {showError && error ? <Text style={audioStyles.error}>{error}</Text> : null}
    </View>
  );
}

function animatedWaveBar(wave: Animated.Value, scaleOutput: number[]) {
  return {
    opacity: wave.interpolate({
      inputRange: [0, 0.33, 0.66, 1],
      outputRange: [0.64, 1, 0.76, 0.64],
    }),
    transform: [
      {
        scaleY: wave.interpolate({
          inputRange: [0, 0.33, 0.66, 1],
          outputRange: scaleOutput,
        }),
      },
    ],
  };
}

const audioStyles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  button: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d9e2de",
    borderRadius: 21,
    backgroundColor: "#f7faf8",
  },
  buttonActive: {
    borderColor: "#18735f",
    backgroundColor: "#18735f",
  },
  compactButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d9e2de",
    borderRadius: 16,
    backgroundColor: "#ffffff",
  },
  loadingText: {
    color: "#0e5648",
    fontSize: 12,
    fontWeight: "900",
  },
  iconMuted: {
    opacity: 0.48,
  },
  wave: {
    height: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  compactWave: {
    height: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  bar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: "#ffffff",
  },
  compactBar: {
    height: 16,
  },
  error: {
    color: "#b42318",
    fontSize: 12,
    fontWeight: "800",
  },
});
