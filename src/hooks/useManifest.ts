import { useCallback, useEffect, useRef, useState } from "react";
import { fetchManifest } from "../data/manifest";
import type { Manifest } from "@voca/core/data/schema";

export type ManifestState = {
  manifest: Manifest | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastLoadedAt: number | null;
};

export function useManifest() {
  const [state, setState] = useState<ManifestState>({
    manifest: null,
    loading: true,
    refreshing: false,
    error: null,
    lastLoadedAt: null,
  });
  const lastSignature = useRef<string | null>(null);

  const refresh = useCallback(async (mode: "initial" | "manual" | "background" = "manual") => {
    setState((current) => ({
      ...current,
      loading: mode === "initial" && !current.manifest,
      refreshing: mode !== "initial",
      error: null,
    }));

    try {
      const next = await fetchManifest();
      lastSignature.current = next.signature;
      setState({
        manifest: next,
        loading: false,
        refreshing: false,
        error: null,
        lastLoadedAt: Date.now(),
      });
      return next;
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : "Cannot load manifest",
      }));
      return null;
    }
  }, []);

  const refreshIfChanged = useCallback(async () => {
    const next = await fetchManifest();
    if (next.signature !== lastSignature.current) {
      lastSignature.current = next.signature;
      setState({
        manifest: next,
        loading: false,
        refreshing: false,
        error: null,
        lastLoadedAt: Date.now(),
      });
    }
  }, []);

  useEffect(() => {
    refresh("initial");
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      refreshIfChanged().catch(() => {
        setState((current) => ({ ...current, error: "Cannot refresh manifest" }));
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshIfChanged]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshIfChanged().catch(() => undefined);
      }
    }, 15000);
    return () => window.clearInterval(id);
  }, [refreshIfChanged]);

  return {
    ...state,
    cards: state.manifest?.cards || [],
    refresh,
  };
}
