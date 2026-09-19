"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";

export type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "smarthire-theme";

/**
 * Authentication and recovery routes deliberately have one, stable visual
 * identity. Public discovery (Home and Jobs) still honours the user's theme
 * preference so the complete Candidate journey can be verified in both
 * themes.
 */
export function isAlwaysLightRoute(pathname: string | null): boolean {
  if (!pathname) return false;

  return [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/two-factor",
    "/check-email",
    "/verify-email",
    "/verify-company-email",
    "/verify-email-change",
    "/account-recovery",
    "/business",
    "/legal",
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

const defaultThemeContext: ThemeContextValue = {
  theme: "light",
  toggleTheme: () => undefined,
};

const ThemeContext = createContext<ThemeContextValue>(defaultThemeContext);
let clientTheme: Theme = "light";
let clientThemeInitialized = false;
const themeListeners = new Set<() => void>();

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

function getPreferredTheme(): Theme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(storedTheme)) return storedTheme;
  } catch {
    // Privacy settings can make localStorage unavailable. The system theme
    // remains a safe, useful fallback in that case.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function subscribeToTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function getClientTheme(): Theme {
  if (!clientThemeInitialized) {
    clientTheme = getPreferredTheme();
    clientThemeInitialized = true;
  }
  return clientTheme;
}

function getServerTheme(): Theme {
  return "light";
}

function updateTheme(theme: Theme) {
  clientTheme = theme;
  clientThemeInitialized = true;
  themeListeners.forEach((listener) => listener());
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getClientTheme,
    getServerTheme,
  );

  const appliedTheme: Theme = isAlwaysLightRoute(pathname) ? "light" : theme;

  useEffect(() => {
    applyTheme(appliedTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme switching still works for the current session without storage.
    }
  }, [appliedTheme, theme]);

  const toggleTheme = useCallback(() => {
    updateTheme(theme === "dark" ? "light" : "dark");
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
