import { SvelteMap } from "svelte/reactivity";
import type { ExtensionUiTheme } from "@nervekit/contracts/extensions";
import {
  defaultColorTheme,
  extensionColorThemeSchema,
  type ColorTheme,
  type ExtensionColorTheme,
} from "@nervekit/contracts/settings";
import {
  appearanceState,
  applyAppearance,
  setExtensionThemeResolver,
} from "./appearance.svelte";
import {
  EXTENSION_THEME_CACHE_KEY,
  EXTENSION_THEME_STYLE_ID,
  extensionThemesCss,
  parseExtensionThemeCache,
  parseThemeTokens,
  reconcileSelectedTheme,
  serializeExtensionThemeCache,
  type ExtensionThemeData,
} from "./extension-theme-cache";
import {
  parseColorTheme,
  themeBackgrounds,
  THEME_STORAGE_KEY,
} from "./theme-preference";

/** A theme a Settings card can show. */
export type ExtensionThemeCard = ExtensionThemeData & {
  label: string;
  extensionName: string;
};

/** Themes that installed extensions contribute, once the daemon has answered. */
export const extensionThemeState = $state({
  cards: [] as ExtensionThemeCard[],
  loaded: false,
});

/** Loaded themes, plus the cached chosen one until the daemon has answered. */
const known = new SvelteMap<ExtensionColorTheme, ExtensionThemeData>();

function styleElement(): HTMLStyleElement | undefined {
  if (typeof document === "undefined") return undefined;
  const existing = document.getElementById(EXTENSION_THEME_STYLE_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const element = document.createElement("style");
  element.id = EXTENSION_THEME_STYLE_ID;
  document.head.append(element);
  return element;
}

function renderStyles(): void {
  const element = styleElement();
  if (element) element.textContent = extensionThemesCss([...known.values()]);
}

/** Resolves any CSS colour to `#rrggbb` through a canvas; `undefined` outside a browser. */
function cssColorToHex(color: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const context = document
      .createElement("canvas")
      .getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return undefined;
  }
}

function writeCache(theme: ColorTheme): void {
  if (typeof localStorage === "undefined") return;
  try {
    const data = known.get(theme as ExtensionColorTheme);
    if (data) {
      localStorage.setItem(
        EXTENSION_THEME_CACHE_KEY,
        serializeExtensionThemeCache(data),
      );
    } else {
      localStorage.removeItem(EXTENSION_THEME_CACHE_KEY);
    }
  } catch {
    // The theme still applies; the next start paints the default until it loads.
  }
}

/**
 * Wires extension themes into the appearance layer. Call once, before the stored theme is
 * applied: the cached tokens of the chosen extension theme make it apply without waiting for
 * the daemon.
 */
export function installExtensionThemes(): void {
  setExtensionThemeResolver({
    kind: (theme) => known.get(theme)?.kind,
    background: (theme) => known.get(theme)?.background,
    applied: writeCache,
  });
  if (typeof localStorage === "undefined") return;
  try {
    const cached = parseExtensionThemeCache(
      localStorage.getItem(EXTENSION_THEME_CACHE_KEY),
    );
    if (cached) {
      known.set(cached.id, cached);
      renderStyles();
    }
  } catch {
    // No cache: the theme applies once the daemon has answered.
  }
}

/**
 * Takes the daemon's list of extension themes: injects their rules, updates the Settings
 * cards, and re-applies the chosen theme (or falls back to the default when it is gone).
 */
export function setLoadedExtensionThemes(themes: ExtensionUiTheme[]): void {
  const loaded: ExtensionThemeCard[] = [];
  for (const theme of themes) {
    const id = extensionColorThemeSchema.safeParse(theme.id);
    const tokens = parseThemeTokens(theme.tokens);
    if (!id.success || !tokens) continue;
    loaded.push({
      id: id.data,
      kind: theme.kind,
      tokens,
      background:
        cssColorToHex(tokens.background) ?? themeBackgrounds["nerve-dark"],
      label: theme.label,
      extensionName: theme.extensionName,
    });
  }
  known.clear();
  for (const theme of loaded) known.set(theme.id, theme);
  renderStyles();
  extensionThemeState.cards = loaded;
  extensionThemeState.loaded = true;

  // The stored preference is never rewritten here: a missing extension theme only applies the
  // default at runtime, and applies again once it is back.
  const preferred = storedPreference() ?? appearanceState.theme;
  const next = reconcileSelectedTheme(preferred, loaded);
  if (next !== appearanceState.theme || next !== defaultColorTheme)
    applyAppearance(next);
}

function storedPreference(): ColorTheme | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === null ? undefined : parseColorTheme(stored);
  } catch {
    return undefined;
  }
}

/** The kind of a loaded extension theme, for views that preview themes. */
export function extensionThemeKind(
  theme: ColorTheme,
): "light" | "dark" | undefined {
  return known.get(theme as ExtensionColorTheme)?.kind;
}
