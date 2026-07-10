import { mode, setMode } from "mode-watcher";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "nerve.sandboxManager.theme";

function readStored(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

/**
 * Local (no server) theme preference for the sandbox manager, applied through
 * `mode-watcher` and persisted to localStorage.
 */
class AppearanceState {
  preference = $state<ThemePreference>(readStored());

  /** The resolved light/dark mode currently applied. */
  get resolved(): "light" | "dark" {
    return mode.current ?? "light";
  }

  apply(): void {
    setMode(this.preference);
  }

  setPreference(next: ThemePreference): void {
    this.preference = next;
    if (typeof localStorage !== "undefined")
      localStorage.setItem(STORAGE_KEY, next);
    this.apply();
  }
}

let singleton: AppearanceState | undefined;

export function useAppearance(): AppearanceState {
  if (!singleton) {
    singleton = new AppearanceState();
    singleton.apply();
  }
  return singleton;
}
