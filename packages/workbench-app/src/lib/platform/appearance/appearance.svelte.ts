import {
  colorThemeKind,
  defaultColorTheme,
  type ColorTheme,
} from "@nervekit/contracts/settings";
import { reportDesktopWindowAppearance } from "../desktop/desktop-bridge.svelte";
import {
  LEGACY_THEME_STORAGE_KEYS,
  THEME_STORAGE_KEY,
  migrateStoredTheme,
  parseColorTheme,
  themeBackgrounds,
} from "./theme-preference";

export const MIN_ZOOM_LEVEL = -8;
export const MAX_ZOOM_LEVEL = 8;
export const ZOOM_BASE = 1.1;

export const appearanceState = $state({
  theme: defaultColorTheme as ColorTheme,
});

export const zoomState = $state({
  level: 0,
});

function readStorage(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The live theme still applies when storage is unavailable.
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // A stale key is harmless; `nerve-theme` takes precedence.
  }
}

/** The theme's kind sets `.dark` and `color-scheme`, so native controls match. */
function syncDocumentTheme(theme: ColorTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const kind = colorThemeKind[theme];
  root.dataset.theme = theme;
  root.classList.toggle("dark", kind === "dark");
  root.style.colorScheme = kind;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeBackgrounds[theme]);
}

/** Applies a theme to the document without persisting it. */
export function applyAppearance(theme: ColorTheme): void {
  appearanceState.theme = theme;
  syncDocumentTheme(theme);
  reportDesktopWindowAppearance({
    background: themeBackgrounds[theme],
    dark: colorThemeKind[theme] === "dark",
  });
}

/** Applies and persists the user's theme choice. */
export function setTheme(theme: ColorTheme): void {
  applyAppearance(theme);
  if (typeof localStorage !== "undefined") {
    writeStorage(THEME_STORAGE_KEY, theme);
  }
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

/**
 * Reads the stored theme. The first load after the light/dark/colour-mode
 * model migrates its keys into `nerve-theme` and removes them.
 */
export function loadAppearancePreference(): ColorTheme {
  if (typeof localStorage === "undefined") return defaultColorTheme;
  const migrating = readStorage(THEME_STORAGE_KEY) === null;
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = migrateStoredTheme(readStorage, prefersDark);
  if (migrating) {
    writeStorage(THEME_STORAGE_KEY, theme);
    for (const key of LEGACY_THEME_STORAGE_KEYS) removeStorage(key);
  }
  return theme;
}

let stopStorageSync: (() => void) | undefined;

/** Install once per client lifecycle; storage events never write back. */
export function installAppearanceStorageSync(): () => void {
  if (stopStorageSync) return stopStorageSync;
  if (typeof window === "undefined") return () => {};
  const browser = window;
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== browser.localStorage) return;
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    applyAppearance(
      parseColorTheme(event.key === null ? null : event.newValue),
    );
  };
  browser.addEventListener("storage", onStorage);
  const dispose = () => {
    browser.removeEventListener("storage", onStorage);
    if (stopStorageSync === dispose) stopStorageSync = undefined;
  };
  stopStorageSync = dispose;
  return dispose;
}
