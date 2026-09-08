/**
 * Which Shiki palette each Nerve color theme highlights code with.
 *
 * A theme that repaints its chrome but leaves code blocks on one fixed palette
 * still reads as a tint, because code is the densest color region in the
 * workbench. Every theme therefore owns a light/dark Shiki pair, and switching
 * themes re-tokenizes rather than emitting one variant per theme into markup.
 *
 * ui-kit stays contract-free, so the theme names are declared locally; they
 * mirror `ColorTheme` in `@nervekit/contracts/settings`.
 */

export const SYNTAX_THEME_PAIRS = {
  nerve: { light: "vitesse-light", dark: "vitesse-dark" },
  rose: { light: "rose-pine-dawn", dark: "rose-pine" },
  solar: { light: "solarized-light", dark: "solarized-dark" },
  midnight: {
    light: "github-light-high-contrast",
    dark: "github-dark-high-contrast",
  },
} as const;

export type SyntaxTheme = keyof typeof SYNTAX_THEME_PAIRS;
export type ShikiThemeName =
  (typeof SYNTAX_THEME_PAIRS)[SyntaxTheme][keyof (typeof SYNTAX_THEME_PAIRS)[SyntaxTheme]];

const DEFAULT_SYNTAX_THEME: SyntaxTheme = "nerve";

type Listener = (theme: SyntaxTheme) => void;

let activeTheme: SyntaxTheme = DEFAULT_SYNTAX_THEME;
const listeners = new Set<Listener>();

export function currentSyntaxTheme(): SyntaxTheme {
  return activeTheme;
}

/**
 * Svelte-store shaped so components can read `$syntaxTheme` and re-highlight
 * without ui-kit taking a rune dependency that its plain-node tests cannot load.
 */
export const syntaxTheme = {
  subscribe(run: Listener): () => void {
    run(activeTheme);
    listeners.add(run);
    return () => listeners.delete(run);
  },
};

export function setSyntaxTheme(theme: string): void {
  if (!(theme in SYNTAX_THEME_PAIRS)) return;
  const next = theme as SyntaxTheme;
  if (next === activeTheme) return;
  activeTheme = next;
  for (const listener of listeners) listener(next);
}
