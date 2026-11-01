import {
  colorThemeKind,
  colorThemeSchema,
  defaultColorTheme,
  type ColorTheme,
  type ColorThemeKind,
} from "@nervekit/contracts/settings";

// The pre-paint bootstrap in index.html mirrors this module; the appearance
// tests run both against the same storage cases.

export const THEME_STORAGE_KEY = "nerve-theme";

const LIGHT_THEME_KEY = "nerve-light-theme";
const DARK_THEME_KEY = "nerve-dark-theme";
const SINGLE_THEME_KEY = "nerve-color-theme";
const MODE_KEY = "mode-watcher-mode";

/** Keys from the light/dark/colour-mode model, removed once migrated. */
export const LEGACY_THEME_STORAGE_KEYS = [
  LIGHT_THEME_KEY,
  DARK_THEME_KEY,
  SINGLE_THEME_KEY,
  MODE_KEY,
  "mode-watcher-theme",
] as const;

/** Single-theme ids that predate independent light and dark themes. */
const singleThemePairs: Record<string, Record<ColorThemeKind, ColorTheme>> = {
  nerve: { light: "nerve-light", dark: "nerve-dark" },
  rose: { light: "nerve-light", dark: "nerve-dark" },
  forest: { light: "nerve-light", dark: "nerve-dark" },
  slate: { light: "nerve-light", dark: "nerve-dark" },
  solar: { light: "nerve-light", dark: "graphite" },
  ocean: { light: "nerve-light", dark: "graphite" },
  midnight: { light: "nerve-light", dark: "graphite" },
};

const kindDefaults: Record<ColorThemeKind, ColorTheme> = {
  light: "nerve-light",
  dark: "nerve-dark",
};

/** Keep in sync with each theme's `--background` in ui-kit theme.css. */
export const themeBackgrounds: Record<ColorTheme, string> = {
  "nerve-light": "#faf8f1",
  "nerve-dark": "#272521",
  "melange-light": "#f4f0ed",
  "melange-dark": "#292522",
  graphite: "#1d1a18",
};

export function parseColorTheme(value: unknown): ColorTheme {
  return colorThemeSchema.safeParse(value).data ?? defaultColorTheme;
}

/**
 * Resolves the stored theme, migrating the light/dark/colour-mode model once:
 * the stored mode picks its slot, and an unset or `system` mode resolves the
 * OS preference (only when a valid old theme exists). Nothing stored, or an
 * invalid `nerve-theme`, yields the default theme.
 */
export function migrateStoredTheme(
  read: (key: string) => string | null | undefined,
  prefersDark: boolean,
): ColorTheme {
  const stored = read(THEME_STORAGE_KEY);
  if (stored !== null && stored !== undefined) return parseColorTheme(stored);

  const single = read(SINGLE_THEME_KEY);
  const pair =
    single && Object.hasOwn(singleThemePairs, single)
      ? singleThemePairs[single]
      : undefined;
  const slots: Record<ColorThemeKind, string | null | undefined> = {
    light: read(LIGHT_THEME_KEY) ?? pair?.light,
    dark: read(DARK_THEME_KEY) ?? pair?.dark,
  };
  const storedSlot = (kind: ColorThemeKind): ColorTheme | undefined => {
    const parsed = colorThemeSchema.safeParse(slots[kind]).data;
    return parsed && colorThemeKind[parsed] === kind ? parsed : undefined;
  };
  const slotTheme = (kind: ColorThemeKind): ColorTheme =>
    storedSlot(kind) ?? kindDefaults[kind];

  const mode = read(MODE_KEY);
  if (mode === "light" || mode === "dark") return slotTheme(mode);
  if (!storedSlot("light") && !storedSlot("dark")) return defaultColorTheme;
  return slotTheme(prefersDark ? "dark" : "light");
}
