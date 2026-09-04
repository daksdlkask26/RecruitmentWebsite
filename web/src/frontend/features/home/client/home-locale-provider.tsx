"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { HomeLocale } from "../home-page-model";
import {
  emptyHomeSearchDraft,
  type HomeSearchDraft,
} from "../home-search-config";

type HomeLocaleValue = {
  locale: HomeLocale;
  setLocale: (locale: HomeLocale) => void;
  searchDraft: HomeSearchDraft;
  setSearchDraft: (draft: HomeSearchDraft) => void;
};
const HomeLocaleContext = createContext<HomeLocaleValue>({
  locale: "vi",
  setLocale: () => undefined,
  searchDraft: emptyHomeSearchDraft,
  setSearchDraft: () => undefined,
});
const homeLocaleStorageKey = "smarthire.home.locale";
const homeLocaleListeners = new Set<() => void>();

function readStoredHomeLocale(fallback: HomeLocale): HomeLocale {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(homeLocaleStorageKey);
    return stored === "vi" || stored === "en" ? stored : fallback;
  } catch {
    return fallback;
  }
}

function subscribeHomeLocale(listener: () => void) {
  homeLocaleListeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      homeLocaleListeners.delete(listener);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === homeLocaleStorageKey) {
      for (const subscriber of homeLocaleListeners) subscriber();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    homeLocaleListeners.delete(listener);
  };
}

export function HomeLocaleProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: HomeLocale;
}) {
  const getLocaleSnapshot = useCallback(
    () => readStoredHomeLocale(initialLocale),
    [initialLocale],
  );
  const getServerLocaleSnapshot = useCallback(
    () => initialLocale,
    [initialLocale],
  );
  const locale = useSyncExternalStore(
    subscribeHomeLocale,
    getLocaleSnapshot,
    getServerLocaleSnapshot,
  );
  const [searchDraft, setSearchDraft] =
    useState<HomeSearchDraft>(emptyHomeSearchDraft);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const updateLocale = useCallback((nextLocale: HomeLocale) => {
    try {
      window.localStorage.setItem(homeLocaleStorageKey, nextLocale);
    } catch {
      // Keep the in-memory locale usable when browser storage is unavailable.
    }
    for (const listener of homeLocaleListeners) listener();
  }, []);
  const value = useMemo(
    () => ({ locale, setLocale: updateLocale, searchDraft, setSearchDraft }),
    [locale, searchDraft, updateLocale],
  );
  return (
    <HomeLocaleContext.Provider value={value}>
      {children}
    </HomeLocaleContext.Provider>
  );
}

export function useHomeLocale() {
  return useContext(HomeLocaleContext);
}
