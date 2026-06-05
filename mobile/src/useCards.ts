import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import NetInfo from "@react-native-community/netinfo";
import { filterCards, type CreatedDateFilter, type Filters } from "@voca/core/data/search";
import { hasCardsCloudSyncTrust } from "./cards-cloud-trust";
import { flushPendingLevelUpdates, loadCachedCards, refreshCards, type CardsSnapshot, type MobileCard } from "./cards";

export const defaultFilters: Filters = {
  query: "",
  topic: "all",
  partOfSpeech: "all",
  createdDate: "all",
};

type CardsLibraryContextValue = {
  snapshot: CardsSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  offlineReady: boolean;
  reload: () => Promise<void>;
  /** When cloud sync trust is set and device is online, revalidates from API (debounced); otherwise reads disk cache. */
  hydrateFromCache: () => Promise<void>;
};

const CardsLibraryContext = createContext<CardsLibraryContextValue | null>(null);

const MIN_CLOUD_FOCUS_REFRESH_MS = 12_000;

export function CardsLibraryProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<CardsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const lastCloudFocusRefreshAt = useRef(0);

  const hydrateFromCache = useCallback(async () => {
    const cached = await loadCachedCards();
    const trusted = await hasCardsCloudSyncTrust();
    const net = await NetInfo.fetch();
    const online = Boolean(net.isConnected && net.isInternetReachable !== false);

    if (trusted && online) {
      const now = Date.now();
      if (now - lastCloudFocusRefreshAt.current >= MIN_CLOUD_FOCUS_REFRESH_MS) {
        lastCloudFocusRefreshAt.current = now;
        setRefreshing(true);
        setError("");
        try {
          await flushPendingLevelUpdates();
          const next = await refreshCards();
          setSnapshot(next);
        } catch (hydrateError) {
          setError(hydrateError instanceof Error ? hydrateError.message : "Cannot refresh cards.");
          if (cached) setSnapshot(cached);
        } finally {
          setRefreshing(false);
          setLoading(false);
        }
        return;
      }
    }

    if (cached) setSnapshot(cached);
  }, []);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      await flushPendingLevelUpdates();
      const next = await refreshCards();
      setSnapshot(next);
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "Cannot refresh cards.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    loadCachedCards()
      .then((cached) => {
        if (mounted && cached) setSnapshot(cached);
      })
      .finally(() => {
        if (mounted) void reload();
      });
    return () => {
      mounted = false;
    };
  }, [reload]);

  const value = useMemo<CardsLibraryContextValue>(
    () => ({
      snapshot,
      loading,
      refreshing,
      error,
      offlineReady: Boolean(snapshot),
      reload,
      hydrateFromCache,
    }),
    [snapshot, loading, refreshing, error, reload, hydrateFromCache],
  );

  return createElement(CardsLibraryContext.Provider, { value }, children);
}

export function useCardsLibrary(): CardsLibraryContextValue {
  const ctx = useContext(CardsLibraryContext);
  if (!ctx) throw new Error("useCardsLibrary must be used within CardsLibraryProvider");
  return ctx;
}

export function useFilteredLibraryCards(filters: Filters): MobileCard[] {
  const { snapshot } = useCardsLibrary();
  return useMemo(
    () =>
      (filterCards(snapshot?.cards || [], filters) as MobileCard[]).sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      ),
    [snapshot?.cards, filters],
  );
}

type CardsState = {
  cards: MobileCard[];
  snapshot: CardsSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  offlineReady: boolean;
  filters: Filters;
  setFilters: (filters: Filters) => void;
  reload: () => Promise<void>;
  hydrateFromCache: () => Promise<void>;
};

/** Cards tab: shared library + local filter state. */
export function useCards(): CardsState {
  const { snapshot, loading, refreshing, error, offlineReady, reload, hydrateFromCache } = useCardsLibrary();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const cards = useFilteredLibraryCards(filters);
  return { cards, snapshot, loading, refreshing, error, offlineReady, filters, setFilters, reload, hydrateFromCache };
}

export function setCreatedDateFilter(filters: Filters, createdDate: CreatedDateFilter): Filters {
  return { ...filters, createdDate };
}
