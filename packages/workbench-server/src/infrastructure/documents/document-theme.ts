/* Design tokens for standalone HTML the daemon renders outside the workbench
 * app (setup pages, fallback shells, conversation exports). These pages cannot
 * load the ui-kit stylesheet, so the Nerve light/dark values are mirrored here
 * and `scripts/checks/test/document-theme-sync.test.mjs` fails if they drift from
 * `packages/ui-kit/src/styles/theme.css`. */

export const documentThemeTokens = {
  light: {
    background: "oklch(0.982 0.003 85)",
    foreground: "oklch(0.24 0.008 70)",
    card: "oklch(0.992 0.002 85)",
    well: "oklch(0.945 0.004 80)",
    "muted-foreground": "oklch(0.5 0.01 70)",
    border: "oklch(0.89 0.006 80)",
    primary: "oklch(0.54 0.155 38)",
    "primary-foreground": "oklch(1 0 0)",
    warning: "oklch(0.5 0.16 70.1)",
  },
  dark: {
    background: "oklch(0.205 0.006 65)",
    foreground: "oklch(0.91 0.006 80)",
    card: "oklch(0.228 0.007 65)",
    well: "oklch(0.165 0.005 65)",
    "muted-foreground": "oklch(0.715 0.01 75)",
    border: "oklch(0.33 0.009 65)",
    primary: "oklch(0.7 0.15 40)",
    "primary-foreground": "oklch(0.17 0.01 40)",
    warning: "oklch(0.82 0.14 75)",
  },
} as const;

/* sRGB fallbacks for hosts that need a plain colour, such as the Electron
 * window background painted before any document loads. */
export const documentBackgroundHex = {
  light: "#faf9f7",
  dark: "#191714",
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
