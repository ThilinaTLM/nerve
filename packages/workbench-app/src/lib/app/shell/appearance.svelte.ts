import { setMode, userPrefersMode } from "mode-watcher";

export type ThemePreference = "system" | "light" | "dark";

export const MIN_ZOOM_LEVEL = -8;
export const MAX_ZOOM_LEVEL = 8;
export const ZOOM_BASE = 1.1;

export const themeState = $state({
  preference: "system" as ThemePreference,
});

export const zoomState = $state({
  level: 0,
});

// Theme switching is delegated to mode-watcher, which toggles the `.dark` class
// on <html>, follows the system preference, and persists the choice.
export function applyTheme(preference = themeState.preference) {
  themeState.preference = preference;
  setMode(preference);
}

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.round(level)));
}

export function zoomScaleForLevel(level: number): number {
  return ZOOM_BASE ** clampZoomLevel(level);
}

export function zoomPercentForLevel(level: number): number {
  return Math.round(zoomScaleForLevel(level) * 100);
}

export function applyZoomLevel(level: number) {
  const next = clampZoomLevel(level);
  const scale = zoomScaleForLevel(next);
  zoomState.level = next;
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--nerve-zoom-scale",
    scale.toFixed(4),
  );
  document.documentElement.style.setProperty(
    "--nerve-inverse-zoom-scale",
    (1 / scale).toFixed(4),
  );
}

export function loadThemePreference(): ThemePreference {
  // mode-watcher restores the persisted mode on mount; mirror it into state.
  return userPrefersMode.current ?? "system";
}
