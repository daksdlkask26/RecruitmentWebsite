"use client";

import { useEffect, useRef, useState } from "react";
import {
  searchSuggestionsResponseSchema,
  type SearchSuggestion,
  type SearchSuggestionScope,
} from "@/shared/contracts/search/search-suggestions";

const SUGGESTION_DEBOUNCE_MS = 300;

export function useSearchSuggestions(
  scope: SearchSuggestionScope,
  value: string,
) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const query = value.trim();
    const compactQuery = query.replace(/\s+/gu, "");
    controller.current?.abort();
    controller.current = null;
    requestId.current += 1;
    const currentRequestId = requestId.current;
    if (compactQuery.length < 2) {
      const clearTimer = window.setTimeout(() => {
        if (currentRequestId !== requestId.current) return;
        setSuggestions([]);
        setIsLoading(false);
        setOpen(false);
        setActiveIndex(-1);
      }, 0);
      return () => window.clearTimeout(clearTimer);
    }

    const timer = window.setTimeout(() => {
      if (currentRequestId !== requestId.current) return;
      setIsLoading(true);
      setOpen(true);
      const nextController = new AbortController();
      controller.current = nextController;
      void fetch(
        `/api/search/suggestions?scope=${scope}&q=${encodeURIComponent(query)}&limit=8`,
        {
          signal: nextController.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("Search suggestions unavailable");
          return searchSuggestionsResponseSchema.parse(await response.json());
        })
        .then((result) => {
          if (currentRequestId !== requestId.current) return;
          setSuggestions(result.suggestions);
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          if (currentRequestId !== requestId.current) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (currentRequestId === requestId.current) {
            controller.current = null;
            setIsLoading(false);
          }
        });
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.current?.abort();
    };
  }, [scope, value]);

  return {
    suggestions,
    isLoading,
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
  };
}
