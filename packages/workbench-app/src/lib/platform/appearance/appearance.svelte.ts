import {
  colorThemeKind,
  colorThemeSchema,
  defaultDarkColorTheme,
  defaultLightColorTheme,
  legacyColorThemes,
  type ColorMode,
  type ColorTheme,
  type ColorThemeKind,
} from "@nervekit/contracts/settings";
import { mode, setMode, userPrefersMode } from "mode-watcher";

const LIGHT_THEME_STORAGE_KEY = "nerve-light-theme";
const DARK_THEME_STORAGE_KEY = "nerve-dark-theme";
/** Single-theme key used before light and dark became independent. */
const LEGACY_COLOR_THEME_STORAGE_KEY = "nerve-color-theme";

export const MIN_ZOOM_LEVEL = -8;
export const MAX_ZOOM_LEVEL = 8;
export const ZOOM_BASE = 1.1;

export const appearanceState = $state({
  lightTheme: defaultLightColorTheme as ColorTheme,
  darkTheme: defaultDarkColorTheme as ColorTheme,
  colorMode: "system" as ColorMode,
});

export const zoomState = $state({
  level: 0,
});

const defaultThemes: Record<ColorThemeKind, ColorTheme> = {
  light: defaultLightColorTheme,
  dark: defaultDarkColorTheme,
};

function parseTheme(value: unknown, kind: ColorThemeKind): ColorTheme {
  const parsed = colorThemeSchema.safeParse(value);
  return parsed.success && colorThemeKind[parsed.data] === kind
    ? parsed.data
    : defaultThemes[kind];
}

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

/** The theme that applies to the document: the resolved mode picks the slot. */
function resolvedTheme(): ColorTheme {
  const dark =
    mode.current === undefined
      ? Boolean(document.documentElement.classList?.contains("dark"))
      : mode.current === "dark";
  return dark ? appearanceState.darkTheme : appearanceState.lightTheme;
}

function syncDocumentTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolvedTheme();
}

let stopThemeBinding: (() => void) | undefined;

/** Keeps `data-theme` current when the mode (including the system's) or either theme changes. */
function bindDocumentTheme(): void {
  if (stopThemeBinding || typeof document === "undefined") return;
  stopThemeBinding = $effect.root(() => {
    $effect(syncDocumentTheme);
  });
}

export function setLightTheme(theme = appearanceState.lightTheme): void {
  appearanceState.lightTheme = theme;
  syncDocumentTheme();
  if (typeof localStorage !== "undefined") {
    writeStorage(LIGHT_THEME_STORAGE_KEY, theme);
  }
}

export function setDarkTheme(theme = appearanceState.darkTheme): void {
  appearanceState.darkTheme = theme;
  syncDocumentTheme();
  if (typeof localStorage !== "undefined") {
    writeStorage(DARK_THEME_STORAGE_KEY, theme);
  }
}

// Color-mode switching remains delegated to mode-watcher, which toggles the
// `.dark` class, follows the system preference, and persists the choice.
export function setColorMode(colorMode = appearanceState.colorMode): void {
  appearanceState.colorMode = colorMode;
  setMode(colorMode);
  syncDocumentTheme();
}

export function applyAppearance(
  themes: { lightTheme: ColorTheme; darkTheme: ColorTheme },
  colorMode: ColorMode,
): void {
  appearanceState.lightTheme = themes.lightTheme;
  appearanceState.darkTheme = themes.darkTheme;
  setColorMode(colorMode);
  bindDocumentTheme();
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
  lightTheme: ColorTheme;
  darkTheme: ColorTheme;
  colorMode: ColorMode;
} {
  let lightTheme = defaultLightColorTheme as ColorTheme;
  let darkTheme = defaultDarkColorTheme as ColorTheme;
  if (typeof localStorage !== "undefined") {
    const storedLight = readStorage(LIGHT_THEME_STORAGE_KEY);
    const storedDark = readStorage(DARK_THEME_STORAGE_KEY);
    const legacy = readStorage(LEGACY_COLOR_THEME_STORAGE_KEY);
    const legacyPair =
      typeof legacy === "string" && Object.hasOwn(legacyColorThemes, legacy)
        ? legacyColorThemes[legacy as keyof typeof legacyColorThemes]
        : undefined;
    lightTheme = parseTheme(storedLight ?? legacyPair?.light, "light");
    darkTheme = parseTheme(storedDark ?? legacyPair?.dark, "dark");
    if (legacy !== null && legacy !== undefined) {
      // Migrate once: persist the pair, then drop the single-theme key.
      writeStorage(LIGHT_THEME_STORAGE_KEY, lightTheme);
      writeStorage(DARK_THEME_STORAGE_KEY, darkTheme);
      try {
        localStorage.removeItem(LEGACY_COLOR_THEME_STORAGE_KEY);
      } catch {
        // A stale legacy key is harmless; the new keys take precedence.
      }
    }
  }
  return {
    lightTheme,
    darkTheme,
    // mode-watcher restores the persisted mode on mount; mirror it into state.
    colorMode: userPrefersMode.current ?? "system",
  };
}

let stopStorageSync: (() => void) | undefined;

/** Install once per client lifecycle; storage events never write back. */
export function installAppearanceStorageSync(): () => void {
  if (stopStorageSync) return stopStorageSync;
  if (typeof window === "undefined") return () => {};
  const browser = window;
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== browser.localStorage) return;
    const cleared = event.key === null;
    if (cleared || event.key === LIGHT_THEME_STORAGE_KEY) {
      appearanceState.lightTheme = parseTheme(
        cleared ? null : event.newValue,
        "light",
      );
    }
    if (cleared || event.key === DARK_THEME_STORAGE_KEY) {
      appearanceState.darkTheme = parseTheme(
        cleared ? null : event.newValue,
        "dark",
      );
    }
    syncDocumentTheme();
  };
  browser.addEventListener("storage", onStorage);
  const dispose = () => {
    browser.removeEventListener("storage", onStorage);
    if (stopStorageSync === dispose) stopStorageSync = undefined;
  };
  stopStorageSync = dispose;
  return dispose;
}
