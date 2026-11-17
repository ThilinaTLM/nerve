import {
  themeFileSchema,
  themeTokensCss,
  type ThemeTokenName,
} from "@nervekit/contracts/extensions";
import {
  colorThemeSchema,
  defaultColorTheme,
  extensionColorThemeSchema,
  type ColorTheme,
  type ColorThemeKind,
  type ExtensionColorTheme,
} from "@nervekit/contracts/settings";

// The pre-paint bootstrap in index.html reads this cache; keep the keys and the stored shape
// (`theme`, `kind`, `background`, `css`) in sync with it.

export const EXTENSION_THEME_CACHE_KEY = "nerve-extension-theme";
/** The `<style>` element holding the rules of extension themes. */
export const EXTENSION_THEME_STYLE_ID = "nerve-extension-themes";

export type ExtensionThemeTokens = Record<ThemeTokenName, string>;

/** A loaded extension theme, as the appearance layer uses it. */
export type ExtensionThemeData = {
  id: ExtensionColorTheme;
  kind: ColorThemeKind;
  tokens: ExtensionThemeTokens;
  /** The `--background` as a hex colour, for the window chrome and `theme-color`. */
  background: string;
};

const tokensSchema = themeFileSchema.shape.tokens;

/** Validates tokens received from the daemon or storage; `undefined` when any is unsafe. */
export function parseThemeTokens(
  value: unknown,
): ExtensionThemeTokens | undefined {
  const parsed = tokensSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The rule of one theme: tokens only, for the document root and for preview roots. Everything
 * else (surfaces, borders, muted) derives from the tokens in the ui-kit theme.
 */
export function extensionThemeRule(
  id: ExtensionColorTheme,
  tokens: ExtensionThemeTokens,
): string {
  if (!extensionColorThemeSchema.safeParse(id).success) return "";
  return `:root[data-theme="${id}"],[data-theme-preview="${id}"]{${themeTokensCss(tokens)}}`;
}

export function extensionThemesCss(
  themes: readonly Pick<ExtensionThemeData, "id" | "tokens">[],
): string {
  return themes
    .map((theme) => extensionThemeRule(theme.id, theme.tokens))
    .join("\n");
}

export function serializeExtensionThemeCache(
  theme: ExtensionThemeData,
): string {
  return JSON.stringify({
    theme: theme.id,
    kind: theme.kind,
    background: theme.background,
    tokens: theme.tokens,
    css: extensionThemeRule(theme.id, theme.tokens),
  });
}

/** Reads the cached theme; `undefined` unless every field is valid. */
export function parseExtensionThemeCache(
  raw: string | null | undefined,
): ExtensionThemeData | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const id = extensionColorThemeSchema.safeParse(value.theme);
    const tokens = parseThemeTokens(value.tokens);
    if (
      !id.success ||
      !tokens ||
      (value.kind !== "light" && value.kind !== "dark") ||
      typeof value.background !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(value.background)
    )
      return undefined;
    return {
      id: id.data,
      kind: value.kind,
      tokens,
      background: value.background,
    };
  } catch {
    return undefined;
  }
}

/**
 * The theme to apply at runtime for the stored preference once the loaded extension themes are
 * known: the preference, or the default while an extension theme is unavailable. The caller
 * never persists the fallback, so the preference applies again when the theme returns.
 */
export function reconcileSelectedTheme(
  selected: ColorTheme,
  loaded: readonly Pick<ExtensionThemeData, "id">[],
): ColorTheme {
  if (!colorThemeSchema.safeParse(selected).success) return defaultColorTheme;
  if (!extensionColorThemeSchema.safeParse(selected).success) return selected;
  return loaded.some((theme) => theme.id === selected)
    ? selected
    : defaultColorTheme;
}
