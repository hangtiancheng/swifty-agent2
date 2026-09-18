export type Theme = "light" | "dark";

/** Must match the inline pre-paint script in index.html */
const KEY = "swifty_agent2_theme";
const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function emit(): void {
  for (const l of listeners) {
    l();
  }
}

export function setTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* Storage may fail (e.g. private mode); ignore — it still applies this session */
  }
  emit();
}

export function toggleTheme(): void {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
