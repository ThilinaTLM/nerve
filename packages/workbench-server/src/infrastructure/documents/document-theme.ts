/* Design tokens for standalone HTML the daemon renders outside the workbench
 * app (setup pages, fallback shells, conversation exports). These pages cannot
 * load the ui-kit stylesheet, so the Nerve light/dark values are mirrored here
 * and `scripts/lib/document-theme-sync.test.mjs` fails if they drift from
 * `packages/ui-kit/src/styles/theme.css`. */

export const documentThemeTokens = {
  light: {
    background: "oklch(0.979 0.009 92)",
    foreground: "oklch(0.3438 0.0269 95.7226)",
    card: "oklch(0.958 0.013 94)",
    well: "oklch(0.938 0.014 95)",
    "muted-foreground": "oklch(0.5341 0.0078 97.4503)",
    border: "oklch(0.872 0.017 95)",
    primary: "oklch(0.57 0.1375 39.0427)",
    "primary-foreground": "oklch(1 0 0)",
    warning: "oklch(0.5 0.16 70.1)",
  },
  dark: {
    background: "oklch(0.264 0.008 80)",
    foreground: "oklch(0.9 0.0027 106.4494)",
    card: "oklch(0.289 0.009 82)",
    well: "oklch(0.205 0.01 78)",
    "muted-foreground": "oklch(0.7713 0.0169 99.0657)",
    border: "oklch(0.353 0.013 82)",
    primary: "oklch(0.6724 0.1308 38.7559)",
    "primary-foreground": "oklch(0.1908 0.002 106.5859)",
    warning: "oklch(0.828 0.16 70.1)",
  },
} as const;

/* sRGB fallbacks for hosts that need a plain colour, such as the Electron
 * window background painted before any document loads. */
export const documentBackgroundHex = {
  light: "#faf8f1",
  dark: "#272521",
} as const;

function tokenBlock(mode: keyof typeof documentThemeTokens): string {
  return Object.entries(documentThemeTokens[mode])
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");
}

/** Token declarations plus the shared element styling every Nerve document uses. */
export function documentStyles(): string {
  return `
      :root { color-scheme: light dark; ${tokenBlock("light")} --radius: 0.375rem; --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      @media (prefers-color-scheme: dark) { :root { ${tokenBlock("dark")} } }
      html { font-family: var(--font-sans); background: var(--background); color: var(--foreground); }
      body { margin: 0; min-height: 100vh; }
      a { color: var(--primary); }
      h1 { margin: 0 0 0.75rem; font-size: 1.5rem; }
      p, li { color: var(--muted-foreground); line-height: 1.55; }
      main { border: 1px solid var(--border); border-radius: calc(var(--radius) * 1.333); background: var(--card); }
      code { font-family: var(--font-mono); font-size: 0.875em; word-break: break-all; background: var(--well); border: 1px solid var(--border); border-radius: calc(var(--radius) * 0.5); padding: 0.125rem 0.375rem; }
      .button { display: inline-block; border: 1px solid transparent; border-radius: calc(var(--radius) * 0.667); padding: 0.5rem 0.75rem; color: var(--primary-foreground); background: var(--primary); text-decoration: none; font-weight: 600; }
      .warning { border: 1px solid color-mix(in oklab, var(--warning) 40%, transparent); border-radius: calc(var(--radius) * 0.667); padding: 0.75rem; background: color-mix(in oklab, var(--warning) 8%, transparent); color: var(--warning); }`;
}
