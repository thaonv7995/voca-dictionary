import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioPlaylist, useAudioPlaylistStatus } from "expo-audio";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { ensureTextAudio } from "./audio";
import {
  buildConversationPlaybackUnits,
  buildConversationPreloadUnits,
  generateDailyConversation,
  type ConversationFormatOption,
  type DailyConversation,
} from "./conversation";
import { logClientError } from "./logging";
import type { ContextScope } from "./practice";
import { loadNonStopListeningEnabled, loadNonStopPreloadCount } from "./settings";

const recentListeningKey = "voca.listen.recentItems";
const BETWEEN_ITEMS_GAP_MS = 1800;
const AFTER_INTRO_GAP_MS = 850;
const PLAYLIST_REFILL_REMAINING_TRACKS = 6;

export type ListeningQueueItem = {
  id: string;
  conversation: DailyConversation;
  contextScope: ContextScope;
  audioStatus: "pending" | "preloading" | "ready" | "partial" | "failed";
  createdAt: string;
};

type RecentListeningItem = {
  id: string;
  title: string;
  context?: string;
  format?: string;
  vocabulary: string[];
  speakers: string[];
  createdAt: string;
};

type QueueParams = {
  format: ConversationFormatOption;
  contextScope: ContextScope;
};

type AudioSource = { uri: string; headers?: Record<string, string> };

type PlaylistTrack = {
  key: string;
  item: ListeningQueueItem;
  ids: string[];
  playbackKey: string;
  source: AudioSource;
  type: "intro" | "line" | "gap";
};

type PlaylistTrackPlan = Omit<PlaylistTrack, "source"> & {
  durationMs?: number;
  guardText?: string;
  resolveSource: () => AudioSource | Promise<AudioSource>;
};

type ListeningPlayerContextValue = {
  activeLineIds: string[];
  activePlaybackKey: string;
  activeSpeaker: string;
  activeText: string;
  currentItem: ListeningQueueItem | null;
  enabled: boolean;
  error: string;
  generating: boolean;
  playing: boolean;
  preparing: boolean;
  preloadCount: number;
  queue: ListeningQueueItem[];
  configure: () => Promise<void>;
  ensureQueue: (params: QueueParams) => Promise<void>;
  generateOne: (params: QueueParams) => Promise<void>;
  playLine: (unit: { ids: string[]; speaker: string; text: string }) => Promise<void>;
  start: (params: QueueParams) => Promise<void>;
  stop: () => void;
  skip: (params?: QueueParams) => Promise<void>;
};

const ListeningPlayerContext = createContext<ListeningPlayerContextValue | null>(null);

export function ListeningPlayerProvider({ children }: PropsWithChildren) {
  const player = useAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const playlist = useAudioPlaylist({ sources: [], updateInterval: 250, loop: "none" });
  const playlistStatus = useAudioPlaylistStatus(playlist);
  const runRef = useRef(0);
  const fillingRef = useRef(false);
  const playlistFillingRef = useRef(false);
  const playlistFinishingRef = useRef(false);
  const playlistAppendingRef = useRef(false);
  const playlistAppendChainRef = useRef<Promise<void>>(Promise.resolve());
  const playlistTracksRef = useRef<PlaylistTrack[]>([]);
  const activeTrackKeyRef = useRef("");
  const paramsRef = useRef<QueueParams | null>(null);
  const currentItemRef = useRef<ListeningQueueItem | null>(null);
  const queueRef = useRef<ListeningQueueItem[]>([]);
  const recentItemsRef = useRef<RecentListeningItem[]>([]);
  const [activeLineIds, setActiveLineIds] = useState<string[]>([]);
  const [activePlaybackKey, setActivePlaybackKey] = useState("");
  const [currentItem, setCurrentItem] = useState<ListeningQueueItem | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preloadCount, setPreloadCount] = useState(1);
  const [queue, setQueue] = useState<ListeningQueueItem[]>([]);
  const [recentItems, setRecentItems] = useState<RecentListeningItem[]>([]);

  useEffect(() => {
    void configure();
    void loadRecentListeningItems().then(setRecentItems);
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    }).catch((audioError) => logClientError(audioError, "listening-audio-mode"));
  }, []);

  useEffect(() => {
    currentItemRef.current = currentItem;
  }, [currentItem]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    recentItemsRef.current = recentItems;
  }, [recentItems]);

  useEffect(() => {
    if (preparing && (playlistStatus.playing || status.playing)) {
      setPreparing(false);
      setPlaying(true);
    }
  }, [playlistStatus.playing, preparing, status.playing]);

  const syncActivePlaylistTrack = useCallback((index: number) => {
    if (!playlistTracksRef.current.length) return;
    const track = playlistTracksRef.current[index];
    if (!track) return;
    if (activeTrackKeyRef.current === track.key) return;
    activeTrackKeyRef.current = track.key;
    const nextCurrent = track.item;
    if (currentItemRef.current?.id !== nextCurrent.id) {
      currentItemRef.current = nextCurrent;
      setCurrentItem(nextCurrent);
      const orderedItems = orderedItemsFromTracks(playlistTracksRef.current.slice(playlistStatus.currentIndex));
      const nextQueue = orderedItems.filter((item) => item.id !== nextCurrent.id);
      queueRef.current = nextQueue;
      setQueue(nextQueue);
    }
    setActiveLineIds(track.type === "line" ? track.ids : []);
    setActivePlaybackKey(track.type === "gap" ? "" : track.playbackKey);
  }, []);

  const handlePlaylistFinished = useCallback(() => {
    const params = paramsRef.current;
    const active = playing || preparing || playlist.currentStatus.playing || playlistTracksRef.current.length > 0;
    if (!active || !params || playlistFinishingRef.current) return;
    playlistFinishingRef.current = true;
    void continueAfterPlaylistFinish(params)
      .catch((finishError) => logClientError(finishError, "non-stop-playlist-finish"));
  }, [playing, playlist, preparing]);

  useEffect(() => {
    if (!playlistStatus.trackCount || !playlistTracksRef.current.length) return;
    syncActivePlaylistTrack(playlistStatus.currentIndex);
  }, [playlistStatus.currentIndex, playlistStatus.currentTime, playlistStatus.trackCount, syncActivePlaylistTrack]);

  useEffect(() => {
    const trackSubscription = playlist.addListener("trackChanged", (event: { currentIndex: number }) => {
      syncActivePlaylistTrack(event.currentIndex);
    });
    const statusSubscription = playlist.addListener("playlistStatusUpdate", (nextStatus: { currentIndex: number; didJustFinish?: boolean; playing: boolean }) => {
      if (nextStatus.playing) syncActivePlaylistTrack(nextStatus.currentIndex);
      if (nextStatus.didJustFinish) handlePlaylistFinished();
    });
    return () => {
      trackSubscription.remove();
      statusSubscription.remove();
    };
  }, [handlePlaylistFinished, playlist, syncActivePlaylistTrack]);

  useEffect(() => {
    if (!playing && !preparing && !playlistStatus.playing) return;
    const interval = setInterval(() => {
      const currentStatus = playlist.currentStatus;
      syncActivePlaylistTrack(currentStatus.currentIndex);
      if (currentStatus.didJustFinish) handlePlaylistFinished();
    }, 250);
    return () => clearInterval(interval);
  }, [handlePlaylistFinished, playing, playlist, playlistStatus.playing, preparing, syncActivePlaylistTrack]);

  useEffect(() => {
    const active = playing || preparing || playlistStatus.playing;
    if (!active || !paramsRef.current || !playlistTracksRef.current.length || playlistFillingRef.current) return;
    const remainingTracks = playlistStatus.trackCount - playlistStatus.currentIndex - 1;
    if (remainingTracks > PLAYLIST_REFILL_REMAINING_TRACKS) return;
    playlistFillingRef.current = true;
    void refillPlaylist(paramsRef.current)
      .catch((refillError) => logClientError(refillError, "non-stop-playlist-refill"))
      .finally(() => {
        playlistFillingRef.current = false;
      });
  }, [playing, playlistStatus.currentIndex, playlistStatus.playing, playlistStatus.trackCount, preparing]);

  useEffect(() => {
    if (playlistStatus.didJustFinish) handlePlaylistFinished();
  }, [handlePlaylistFinished, playlistStatus.didJustFinish]);

  const configure = useCallback(async () => {
    const [nextEnabled, nextPreloadCount] = await Promise.all([loadNonStopListeningEnabled(), loadNonStopPreloadCount()]);
    setEnabled(nextEnabled);
    setPreloadCount(nextPreloadCount);
  }, []);

  const rememberItem = useCallback(async (item: ListeningQueueItem) => {
    const currentRecent = recentItemsRef.current;
    const nextRecent = [recentItemFromQueueItem(item), ...currentRecent.filter((recent) => recent.id !== item.id)].slice(0, 5);
    recentItemsRef.current = nextRecent;
    setRecentItems(nextRecent);
    await AsyncStorage.setItem(recentListeningKey, JSON.stringify(nextRecent));
  }, []);

  const fillQueue = useCallback(async (params: QueueParams, minimumReady: number) => {
    if (fillingRef.current) {
      await waitUntil(() => !fillingRef.current, 30_000);
      if ((currentItemRef.current ? 1 : 0) + queueRef.current.length >= minimumReady) return;
    }
    fillingRef.current = true;
    setGenerating(true);
    setError("");
    try {
      while ((currentItemRef.current ? 1 : 0) + queueRef.current.length < minimumReady) {
        const recentVocabulary = recentItemsRef.current.flatMap((item) => item.vocabulary);
        const recentSituations = recentItemsRef.current.map((item) => item.context || item.title);
        const conversation = await generateDailyConversation({
          format: params.format,
          contextScope: params.contextScope,
          recentSituations,
          recentVocabulary,
        });
        const item: ListeningQueueItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          conversation,
          contextScope: params.contextScope,
          audioStatus: "preloading",
          createdAt: new Date().toISOString(),
        };
        if (!currentItemRef.current) {
          currentItemRef.current = item;
          setCurrentItem(item);
        } else {
          const nextQueue = [...queueRef.current, item];
          queueRef.current = nextQueue;
          setQueue(nextQueue);
        }
        await rememberItem(item);
        void preloadItemAudio(item).catch((preloadError) => logClientError(preloadError, "non-stop-background-audio-preload"));
      }
    } catch (fillError) {
      const message = fillError instanceof Error ? fillError.message : "Cannot prepare non-stop listening.";
      setError(message);
      await logClientError(fillError, "non-stop-fill");
    } finally {
      fillingRef.current = false;
      setGenerating(false);
    }
  }, [rememberItem]);

  const ensureQueue = useCallback(async (params: QueueParams) => {
    paramsRef.current = params;
    await fillQueue(params, targetReadyCount(preloadCount));
  }, [fillQueue, preloadCount]);

  const generateOne = useCallback(async (params: QueueParams) => {
    paramsRef.current = params;
    playlist.pause();
    playlist.clear();
    playlistTracksRef.current = [];
    activeTrackKeyRef.current = "";
    stopInternal(player, runRef, setActiveLineIds, setActivePlaybackKey, setPlaying, setPreparing);
    setCurrentItem(null);
    currentItemRef.current = null;
    setQueue([]);
    queueRef.current = [];
    setGenerating(true);
    setError("");
    try {
      const recentVocabulary = recentItemsRef.current.flatMap((item) => item.vocabulary);
      const recentSituations = recentItemsRef.current.map((item) => item.context || item.title);
      const conversation = await generateDailyConversation({
        format: params.format,
        contextScope: params.contextScope,
        recentSituations,
        recentVocabulary,
      });
      const item: ListeningQueueItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conversation,
        contextScope: params.contextScope,
        audioStatus: "pending",
        createdAt: new Date().toISOString(),
      };
      currentItemRef.current = item;
      setCurrentItem(item);
      await rememberItem(item);
      void preloadCurrentAndFillQueue(item, params, preloadCount, fillQueue, setCurrentItem, currentItemRef).catch((preloadError) => {
        void logClientError(preloadError, "non-stop-background-preload");
      });
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : "Cannot generate listening item.";
      setError(message);
      await logClientError(generateError, "non-stop-generate");
    } finally {
      setGenerating(false);
    }
  }, [fillQueue, player, playlist, preloadCount, rememberItem]);

  const playLine = useCallback(async (unit: { ids: string[]; speaker: string; text: string }) => {
    const item = currentItemRef.current;
    if (!item) return;
    const playbackKey = playbackKeyForIds(unit.ids);
    const runId = runRef.current + 1;
    runRef.current = runId;
    playlist.pause();
    player.pause();
    void player.seekTo(0).catch(() => undefined);
    setActiveLineIds(unit.ids);
    setActivePlaybackKey(playbackKey);
    setPreparing(true);
    setPlaying(false);
    setError("");
    try {
      const source = await ensureTextAudio(unit.text, item.conversation.voiceAssignments[unit.speaker]);
      if (runRef.current !== runId) return;
      player.replace(source);
      player.setActiveForLockScreen(true, { title: item.conversation.title, artist: unit.speaker });
      player.play();
      setPreparing(false);
      setPlaying(true);
      await waitForPlaybackToFinish(player, unit.text, () => runRef.current === runId);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Cannot play audio.");
    } finally {
      if (runRef.current === runId) {
        setActiveLineIds([]);
        setActivePlaybackKey("");
        setPreparing(false);
        setPlaying(false);
      }
    }
  }, [player, playlist]);

  const start = useCallback(async (params: QueueParams) => {
    if (preparing || playing || playlistStatus.playing) return;
    paramsRef.current = params;
    const runId = runRef.current + 1;
    runRef.current = runId;
    activeTrackKeyRef.current = "";
    setPreparing(true);
    setPlaying(false);
    setError("");
    try {
      player.pause();
      playlist.pause();
      playlist.clear();
      playlistTracksRef.current = [];
      await fillQueue(params, 1);
      if (runRef.current !== runId) return;
      void playSequentialNonStop(runId, params);
      void fillQueue(params, targetReadyCount(preloadCount));
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Cannot play non-stop listening.");
      await logClientError(playError, "non-stop-play");
      if (runRef.current === runId) {
        setPreparing(false);
        setPlaying(false);
      }
    }
  }, [fillQueue, player, playing, playlist, playlistStatus.playing, preparing, preloadCount]);

  async function playSequentialNonStop(runId: number, params: QueueParams): Promise<void> {
    try {
      while (runRef.current === runId) {
        if (!currentItemRef.current) {
          await fillQueue(params, 1);
          if (!currentItemRef.current) throw new Error("Audio is not ready yet.");
        }
        const item = currentItemRef.current;
        const plans = buildPlaylistTrackPlans([item]);
        if (!plans.length) throw new Error("Audio is not ready yet.");

        currentItemRef.current = item;
        setCurrentItem(item);

        for (const plan of plans) {
          if (runRef.current !== runId) return;
          setPreparing(true);
          if (plan.type === "gap") {
            player.pause();
            setActiveLineIds([]);
            setActivePlaybackKey("");
            await delay(plan.durationMs || 0);
            continue;
          }
          const track = await resolvePlaylistTrack(plan);
          if (runRef.current !== runId) return;

          activeTrackKeyRef.current = track.key;
          setActiveLineIds(track.type === "line" ? track.ids : []);
          setActivePlaybackKey(track.type === "gap" ? "" : track.playbackKey);
          player.pause();
          player.replace(track.source);
          await player.seekTo(0).catch(() => undefined);
          player.setActiveForLockScreen(
            true,
            {
              title: track.item.conversation.title,
              artist: lockScreenArtist(track.item, track.ids, track.type),
              albumTitle: "Voca Listening",
            },
            { showSeekBackward: false, showSeekForward: false },
          );
          await delay(80);
          player.play();
          setPreparing(false);
          setPlaying(true);
          await waitForTrackToFinish(player, plan, () => runRef.current === runId);
        }

        if (runRef.current !== runId) return;
        setActiveLineIds([]);
        setActivePlaybackKey("");
        setPreparing(true);
        player.pause();
        let [nextItem, ...rest] = queueRef.current;
        if (!nextItem) {
          currentItemRef.current = null;
          await fillQueue(params, 1);
          const generatedItem = currentItemRef.current;
          if (generatedItem) nextItem = generatedItem;
          rest = queueRef.current;
        }
        queueRef.current = rest;
        setQueue(rest);
        currentItemRef.current = nextItem || null;
        setCurrentItem(nextItem || null);
        if (nextItem) await delay(BETWEEN_ITEMS_GAP_MS);
        void fillQueue(params, targetReadyCount(preloadCount));
      }
    } catch (loopError) {
      if (runRef.current === runId) {
        setError(loopError instanceof Error ? loopError.message : "Cannot continue non-stop listening.");
        setPreparing(false);
        setPlaying(false);
        setActiveLineIds([]);
        setActivePlaybackKey("");
      }
      await logClientError(loopError, "non-stop-sequential-playback");
    }
  }

  async function refillPlaylist(params: QueueParams): Promise<void> {
    if (playlistTracksRef.current.length) {
      const remainingItems = orderedItemsFromTracks(playlistTracksRef.current.slice(playlistStatus.currentIndex));
      const [nextCurrent, ...nextQueue] = remainingItems;
      currentItemRef.current = nextCurrent || null;
      queueRef.current = nextQueue;
    }
    await fillQueue(params, targetReadyCount(preloadCount));
    const existingIds = new Set(playlistTracksRef.current.map((track) => track.item.id));
    const newItems = readyItemsForPlaylist(currentItemRef.current, queueRef.current).filter((item) => !existingIds.has(item.id));
    if (!newItems.length) return;
    queueAppendTrackPlans(runRef.current, buildPlaylistTrackPlans(newItems));
  }

  function queueAppendTrackPlans(runId: number, plans: PlaylistTrackPlan[]): void {
    if (!plans.length) return;
    playlistAppendChainRef.current = playlistAppendChainRef.current
      .catch(() => undefined)
      .then(async () => {
        playlistAppendingRef.current = true;
        for (const plan of plans) {
          if (runRef.current !== runId) return;
          if (playlistTracksRef.current.some((track) => track.key === plan.key)) continue;
          const track = await resolvePlaylistTrack(plan);
          if (runRef.current !== runId) return;
          if (playlistTracksRef.current.some((item) => item.key === track.key)) continue;
          playlistTracksRef.current = [...playlistTracksRef.current, track];
          playlist.add(track.source);
        }
      })
      .finally(() => {
        playlistAppendingRef.current = false;
      });
  }

  async function continueAfterPlaylistFinish(params: QueueParams): Promise<void> {
    const runId = runRef.current;
    const finishedTrackCount = playlistTracksRef.current.length;
    setPreparing(true);
    setPlaying(false);
    setActiveLineIds([]);
    setActivePlaybackKey("");
    try {
      await waitUntil(() => playlistTracksRef.current.length > finishedTrackCount || (!playlistFillingRef.current && !playlistAppendingRef.current), 10_000);
      if (runRef.current !== runId) return;

      if (playlistTracksRef.current.length > finishedTrackCount) {
        const nextTrack = playlistTracksRef.current[finishedTrackCount];
        playlist.skipTo(finishedTrackCount);
        if (nextTrack) {
          currentItemRef.current = nextTrack.item;
          setCurrentItem(nextTrack.item);
          setActiveLineIds(nextTrack.type === "line" ? nextTrack.ids : []);
          setActivePlaybackKey(nextTrack.type === "gap" ? "" : nextTrack.playbackKey);
        }
        playlist.play();
        setPreparing(false);
        setPlaying(true);
        return;
      }

      const [nextItem, ...rest] = queueRef.current;
      currentItemRef.current = nextItem || null;
      setCurrentItem(nextItem || null);
      queueRef.current = rest;
      setQueue(rest);
      await fillQueue(params, 1);
      if (runRef.current !== runId) return;
      const plans = buildPlaylistTrackPlans(readyItemsForPlaylist(currentItemRef.current, queueRef.current));
      if (runRef.current !== runId) return;
      if (!plans.length) throw new Error("Audio is not ready yet.");
      const firstTrack = await resolvePlaylistTrack(plans[0]);
      if (runRef.current !== runId) return;
      playlist.pause();
      playlist.clear();
      playlistTracksRef.current = [firstTrack];
      playlist.add(firstTrack.source);
      currentItemRef.current = firstTrack.item;
      setCurrentItem(firstTrack.item);
      setActiveLineIds(firstTrack.type === "line" ? firstTrack.ids : []);
      setActivePlaybackKey(firstTrack.type === "gap" ? "" : firstTrack.playbackKey);
      playlist.play();
      setPreparing(false);
      setPlaying(true);
      queueAppendTrackPlans(runId, plans.slice(1));
      void fillQueue(params, targetReadyCount(preloadCount));
    } catch (finishError) {
      if (runRef.current === runId) {
        setError(finishError instanceof Error ? finishError.message : "Cannot continue non-stop listening.");
        setPreparing(false);
        setPlaying(false);
      }
      throw finishError;
    } finally {
      playlistFinishingRef.current = false;
    }
  }

  const stop = useCallback(() => {
    playlist.pause();
    playlist.clear();
    playlistTracksRef.current = [];
    activeTrackKeyRef.current = "";
    stopInternal(player, runRef, setActiveLineIds, setActivePlaybackKey, setPlaying, setPreparing);
  }, [player, playlist]);

  const skip = useCallback(async (params?: QueueParams) => {
    const nextParams = params || paramsRef.current;
    if (!nextParams) return;
    if (playing || preparing || status.playing) {
      stopInternal(player, runRef, setActiveLineIds, setActivePlaybackKey, setPlaying, setPreparing);
      playlist.pause();
      playlist.clear();
      playlistTracksRef.current = [];
      activeTrackKeyRef.current = "";
      let [nextItem, ...rest] = queueRef.current;
      if (!nextItem) {
        currentItemRef.current = null;
        await fillQueue(nextParams, 1);
        const generatedItem = currentItemRef.current;
        if (generatedItem) nextItem = generatedItem;
        rest = queueRef.current;
      }
      queueRef.current = rest;
      setQueue(rest);
      currentItemRef.current = nextItem || null;
      setCurrentItem(nextItem || null);
      const runId = runRef.current + 1;
      runRef.current = runId;
      setPreparing(true);
      void playSequentialNonStop(runId, nextParams);
      void fillQueue(nextParams, targetReadyCount(preloadCount));
      return;
    }
    if (playlistStatus.playing && playlistTracksRef.current.length) {
      const currentTrack = playlistTracksRef.current[playlistStatus.currentIndex];
      const nextIndex = playlistTracksRef.current.findIndex((track, index) => index > playlistStatus.currentIndex && track.item.id !== currentTrack?.item.id && track.type !== "gap");
      if (nextIndex >= 0) {
        playlist.skipTo(nextIndex);
        return;
      }
    }
    stopInternal(player, runRef, setActiveLineIds, setActivePlaybackKey, setPlaying, setPreparing);
    playlist.pause();
    playlist.clear();
    playlistTracksRef.current = [];
    activeTrackKeyRef.current = "";
    const [nextItem, ...rest] = queueRef.current;
    queueRef.current = rest;
    setQueue(rest);
    currentItemRef.current = nextItem || null;
    setCurrentItem(nextItem || null);
    await fillQueue(nextParams, targetReadyCount(preloadCount));
  }, [fillQueue, player, playing, playlist, playlistStatus.currentIndex, playlistStatus.playing, preparing, preloadCount, status.playing]);

  const value = useMemo<ListeningPlayerContextValue>(() => ({
    activeLineIds,
    activePlaybackKey,
    activeSpeaker: activeListeningSpeaker(currentItem, activeLineIds),
    activeText: activeListeningText(currentItem, activeLineIds),
    currentItem,
    enabled,
    error,
    generating,
    playing: playing || status.playing || playlistStatus.playing,
    preparing,
    preloadCount,
    queue,
    configure,
    ensureQueue,
    generateOne,
    playLine,
    start,
    stop,
    skip,
  }), [activeLineIds, activePlaybackKey, currentItem, enabled, error, generating, playing, preparing, status.playing, playlistStatus.playing, preloadCount, queue, configure, ensureQueue, generateOne, playLine, start, stop, skip]);

  return <ListeningPlayerContext.Provider value={value}>{children}</ListeningPlayerContext.Provider>;
}

export function useListeningPlayer() {
  const value = useContext(ListeningPlayerContext);
  if (!value) throw new Error("useListeningPlayer must be used inside ListeningPlayerProvider.");
  return value;
}

async function preloadItemAudio(item: ListeningQueueItem): Promise<void> {
  const introUnit = buildConversationIntroUnit(item);
  if (introUnit) {
    await ensureTextAudio(introUnit.text, item.conversation.voiceAssignments[introUnit.speaker]);
  }
  await runWithConcurrency(buildConversationPreloadUnits(item.conversation), 2, async (unit) => {
    await ensureTextAudio(unit.text, item.conversation.voiceAssignments[unit.speaker]);
  });
}

async function buildPlaylistTracks(items: ListeningQueueItem[]): Promise<PlaylistTrack[]> {
  const tracks: PlaylistTrack[] = [];
  for (const plan of buildPlaylistTrackPlans(items)) {
    tracks.push(await resolvePlaylistTrack(plan));
  }
  return tracks;
}

function buildPlaylistTrackPlans(items: ListeningQueueItem[]): PlaylistTrackPlan[] {
  const tracks: PlaylistTrackPlan[] = [];
  for (const item of items) {
    const introUnit = buildConversationIntroUnit(item);
    if (introUnit) {
      tracks.push({
        key: `${item.id}:intro`,
        guardText: introUnit.text,
        item,
        ids: introUnit.ids,
        playbackKey: playbackKeyForIds(introUnit.ids),
        resolveSource: () => ensureTextAudio(introUnit.text, item.conversation.voiceAssignments[introUnit.speaker]),
        type: "intro",
      });
      tracks.push({
        key: `${item.id}:intro-gap`,
        durationMs: AFTER_INTRO_GAP_MS,
        item,
        ids: [],
        playbackKey: "",
        resolveSource: () => ({ uri: "", headers: {} }),
        type: "gap",
      });
    }
    for (const [index, unit] of buildConversationPlaybackUnits(item.conversation).entries()) {
      tracks.push({
        key: `${item.id}:line:${index}:${playbackKeyForIds(unit.ids)}`,
        guardText: unit.text,
        item,
        ids: unit.ids,
        playbackKey: playbackKeyForIds(unit.ids),
        resolveSource: () => ensureTextAudio(unit.text, item.conversation.voiceAssignments[unit.speaker]),
        type: "line",
      });
    }
  }
  return tracks;
}

async function resolvePlaylistTrack(plan: PlaylistTrackPlan): Promise<PlaylistTrack> {
  const source = await plan.resolveSource();
  return {
    key: plan.key,
    item: plan.item,
    ids: plan.ids,
    playbackKey: plan.playbackKey,
    source,
    type: plan.type,
  };
}

function readyItemsForPlaylist(currentItem: ListeningQueueItem | null, queue: ListeningQueueItem[]): ListeningQueueItem[] {
  return [currentItem, ...queue].filter((item): item is ListeningQueueItem => Boolean(item));
}

function activeListeningSpeaker(item: ListeningQueueItem | null, activeIds: string[]): string {
  if (!item || !activeIds.length) return "";
  if (activeIds[0]?.startsWith("intro:")) return "Intro";
  const line = item.conversation.lines.find((entry) => activeIds.includes(entry.id));
  return line?.speaker || "";
}

function activeListeningText(item: ListeningQueueItem | null, activeIds: string[]): string {
  if (!item) return "";
  if (!activeIds.length) return item.conversation.context || item.conversation.title;
  if (activeIds[0]?.startsWith("intro:")) {
    return [item.conversation.title, item.conversation.context].filter(Boolean).join(". ");
  }
  return item.conversation.lines
    .filter((line) => activeIds.includes(line.id))
    .map((line) => line.text)
    .join(" ");
}

function lockScreenArtist(item: ListeningQueueItem, activeIds: string[], type: PlaylistTrack["type"]): string {
  if (type === "intro") return item.conversation.context || "Voca Listening";
  if (type === "gap") return "Voca Listening";
  const speaker = activeListeningSpeaker(item, activeIds);
  const text = activeListeningText(item, activeIds);
  return [speaker, text].filter(Boolean).join(" · ") || "Voca Listening";
}

function orderedItemsFromTracks(tracks: PlaylistTrack[]): ListeningQueueItem[] {
  const seen = new Set<string>();
  const ordered: ListeningQueueItem[] = [];
  for (const track of tracks) {
    if (seen.has(track.item.id)) continue;
    seen.add(track.item.id);
    ordered.push(track.item);
  }
  return ordered;
}

function buildConversationIntroUnit(item: ListeningQueueItem): { ids: string[]; speaker: string; text: string } | null {
  const title = item.conversation.title.trim();
  const context = String(item.conversation.context || "").trim();
  const text = [title, context].filter(Boolean).join(". ");
  if (!text) return null;
  return {
    ids: [`intro:${item.id}`],
    speaker: item.conversation.speakers[0] || item.conversation.lines[0]?.speaker || "Narrator",
    text,
  };
}

async function preloadCurrentAndFillQueue(
  item: ListeningQueueItem,
  params: QueueParams,
  preloadCount: number,
  fillQueue: (params: QueueParams, minimumReady: number) => Promise<void>,
  setCurrentItem: (item: ListeningQueueItem | null) => void,
  currentItemRef: { current: ListeningQueueItem | null },
) {
  const preloadingItem = { ...item, audioStatus: "preloading" as const };
  currentItemRef.current = preloadingItem;
  setCurrentItem(preloadingItem);
  try {
    await preloadItemAudio(preloadingItem);
    if (currentItemRef.current?.id === item.id) {
      const readyItem = { ...preloadingItem, audioStatus: "ready" as const };
      currentItemRef.current = readyItem;
      setCurrentItem(readyItem);
    }
  } catch {
    if (currentItemRef.current?.id === item.id) {
      const partialItem = { ...preloadingItem, audioStatus: "partial" as const };
      currentItemRef.current = partialItem;
      setCurrentItem(partialItem);
    }
  }
  await fillQueue(params, targetReadyCount(preloadCount));
}

async function loadRecentListeningItems(): Promise<RecentListeningItem[]> {
  const raw = await AsyncStorage.getItem(recentListeningKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function recentItemFromQueueItem(item: ListeningQueueItem): RecentListeningItem {
  const vocabulary = Array.from(new Set(item.conversation.lines.flatMap((line) => line.vocabulary || []).map((word) => word.trim()).filter(Boolean)));
  return {
    id: item.id,
    title: item.conversation.title,
    context: item.conversation.context,
    format: item.conversation.format,
    vocabulary,
    speakers: item.conversation.speakers,
    createdAt: item.createdAt,
  };
}

function stopInternal(
  player: { pause: () => void; seekTo: (seconds: number) => Promise<void>; clearLockScreenControls?: () => void },
  runRef: { current: number },
  setActiveLineIds: (ids: string[]) => void,
  setActivePlaybackKey: (key: string) => void,
  setPlaying: (playing: boolean) => void,
  setPreparing: (preparing: boolean) => void,
) {
  runRef.current += 1;
  player.pause();
  void player.seekTo(0).catch(() => undefined);
  player.clearLockScreenControls?.();
  setActiveLineIds([]);
  setActivePlaybackKey("");
  setPreparing(false);
  setPlaying(false);
}

function playbackKeyForIds(ids: string[]): string {
  return ids.join("|");
}

function targetReadyCount(preloadCount: number): number {
  return Math.max(1, preloadCount + 1);
}

async function waitForPlaybackToFinish(
  player: { currentStatus: { currentTime: number; didJustFinish: boolean; duration: number; isLoaded: boolean; playing: boolean } },
  text: string,
  shouldContinue: () => boolean,
): Promise<void> {
  const timeoutAt = Date.now() + playbackGuardMilliseconds(text);
  while (Date.now() < timeoutAt && shouldContinue()) {
    const current = player.currentStatus;
    const nearEnd = current.duration > 0 && current.currentTime >= current.duration - 0.12;
    if (current.didJustFinish || nearEnd) return;
    await delay(120);
  }
}

async function waitForTrackToFinish(
  player: { currentStatus: { currentTime: number; didJustFinish: boolean; duration: number; isLoaded: boolean; playing: boolean } },
  plan: Pick<PlaylistTrackPlan, "durationMs" | "guardText">,
  shouldContinue: () => boolean,
): Promise<void> {
  const guardMs = plan.durationMs
    ? plan.durationMs + 2500
    : playbackGuardMilliseconds(plan.guardText || "");
  const startedAt = Date.now();
  const timeoutAt = Date.now() + guardMs;
  let observedPlaybackStart = false;
  let maxObservedTime = 0;
  while (Date.now() < timeoutAt && shouldContinue()) {
    const current = player.currentStatus;
    const elapsed = Date.now() - startedAt;
    maxObservedTime = Math.max(maxObservedTime, current.currentTime || 0);
    if (current.playing || (current.currentTime > 0.15 && (!current.duration || current.currentTime < current.duration - 0.25))) {
      observedPlaybackStart = true;
    }
    const nearEnd = current.duration > 0 && current.currentTime > 0.15 && current.currentTime >= current.duration - 0.12;
    if (observedPlaybackStart && elapsed > 700 && (current.didJustFinish || nearEnd)) return;
    if (!observedPlaybackStart && elapsed > 2500 && maxObservedTime <= 0.15) return;
    await delay(120);
  }
}

function playbackGuardMilliseconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(10 * 60 * 1000, Math.max(60 * 1000, words * 900 + 30 * 1000));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate: () => boolean, timeoutMilliseconds: number): Promise<void> {
  const timeoutAt = Date.now() + timeoutMilliseconds;
  while (!predicate() && Date.now() < timeoutAt) {
    await delay(120);
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      try {
        await worker(item);
      } catch {
        // Background preload is best-effort.
      }
    }
  });
  await Promise.all(workers);
}
