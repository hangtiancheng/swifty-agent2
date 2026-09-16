import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "mewhelp_theme";
const listeners = new Set<() => void>();

function currentTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function emit() {
  for (const l of listeners) {
    l();
  }
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* Storage may fail (e.g. private mode); ignore — it still applies this session */
  }
  emit();
}

export function toggleTheme() {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    currentTheme,
    () => "light",
  );
}

/** Inline script injected into <head>: applies .dark per stored preference or system
    setting before first paint, avoiding a light-mode flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}if(t==="dark"){document.documentElement.classList.add("dark");}}catch(e){}})();`;
