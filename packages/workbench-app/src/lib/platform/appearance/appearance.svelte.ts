import {
  colorThemeSchema,
  type ColorMode,
  type ColorTheme,
} from "@nervekit/contracts/settings";
import { setMode, userPrefersMode } from "mode-watcher";

const COLOR_THEME_STORAGE_KEY = "nerve-color-theme";

export const MIN_ZOOM_LEVEL = -8;
export const MAX_ZOOM_LEVEL = 8;
export const ZOOM_BASE = 1.1;

export const appearanceState = $state({
  theme: "nerve" as ColorTheme,
  colorMode: "system" as ColorMode,
});

export const zoomState = $state({
  level: 0,
});

function storeColorTheme(theme: ColorTheme): void {
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    // The live theme still applies when storage is unavailable.
  }
}

function storedColorTheme(): unknown {
  try {
    return localStorage.getItem(COLOR_THEME_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

export function applyColorTheme(theme = appearanceState.theme): void {
  appearanceState.theme = theme;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  if (typeof localStorage !== "undefined") storeColorTheme(theme);
}

// Color-mode switching remains delegated to mode-watcher, which toggles the
// `.dark` class, follows the system preference, and persists the choice.
export function applyColorMode(colorMode = appearanceState.colorMode): void {
  appearanceState.colorMode = colorMode;
  setMode(colorMode);
}

export function applyAppearance(theme: ColorTheme, colorMode: ColorMode): void {
  applyColorTheme(theme);
  applyColorMode(colorMode);
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

export function loadAppearancePreference(): {
  theme: ColorTheme;
  colorMode: ColorMode;
} {
  const storedTheme =
    typeof localStorage === "undefined" ? undefined : storedColorTheme();
  const parsedTheme = colorThemeSchema.safeParse(storedTheme);
  return {
    theme: parsedTheme.success ? parsedTheme.data : "nerve",
    // mode-watcher restores the persisted mode on mount; mirror it into state.
    colorMode: userPrefersMode.current ?? "system",
  };
}
