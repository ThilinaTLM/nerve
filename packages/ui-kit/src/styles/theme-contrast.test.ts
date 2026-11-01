import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const minimumTextContrast = 4.5;
const themeCss = readFileSync(
  fileURLToPath(new URL("./theme.css", import.meta.url)),
  "utf8",
);
const badgeSource = readFileSync(
  fileURLToPath(
    new URL("../lib/components/ui/badge/badge.svelte", import.meta.url),
  ),
  "utf8",
);

type Oklch = readonly [lightness: number, chroma: number, hue: number];
type LinearRgb = readonly [red: number, green: number, blue: number];
type ColorTheme = "nerve" | "rose" | "solar" | "midnight";
type ColorMode = "light" | "dark";
type ThemeName = `${ColorTheme}-${ColorMode}`;

const tokenNames = [
  "background",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "panel",
  "well",
  "primary",
  "primary-foreground",
  "muted",
  "foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "info",
  "info-foreground",
  "destructive",
  "destructive-foreground",
  "destructive-solid",
  "destructive-solid-foreground",
  "border",
  "accent",
] as const;
type TokenName = (typeof tokenNames)[number];

function themeBlock(theme: ColorTheme, mode: ColorMode): string {
  const selector = `[data-theme-preview="${theme}"][data-color-mode="${mode}"]`;
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = themeCss.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `Missing ${theme} ${mode} theme block`);
  return match[1];
}

/* Declarations shared by every theme (`:root, [data-theme-preview]`): aliases
 * such as `--card-foreground: var(--foreground)` resolve against the theme block
 * first, then against this one. */
function globalBlock(): string {
  const match = themeCss.match(
    /:root,\s*\[data-theme-preview\]\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(match, "Missing global `:root, [data-theme-preview]` block");
  return match[1];
}

function declarationOf(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
}

function resolveOklch(block: string, name: string, label: string): Oklch {
  let value = declarationOf(block, name) ?? declarationOf(globalBlock(), name);
  const seen = new Set<string>();
  while (value !== undefined) {
    const alias = value.match(/^var\(--([\w-]+)\)$/);
    if (!alias) break;
    assert.ok(!seen.has(alias[1]!), `Circular alias --${name} in ${label}`);
    seen.add(alias[1]!);
    // An alias resolves where it is declared: the theme block wins over global.
    value =
      declarationOf(block, alias[1]!) ??
      declarationOf(globalBlock(), alias[1]!);
  }
  const match = value?.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  assert.ok(match, `Missing OKLCH token --${name} in ${label}`);
  return match.slice(1, 4).map(Number) as unknown as Oklch;
}

function parseTokens(
  theme: ColorTheme,
  mode: ColorMode,
): Record<TokenName, Oklch> {
  const block = themeBlock(theme, mode);
  return Object.fromEntries(
    tokenNames.map((name) => [
      name,
      resolveOklch(block, name, `${theme} ${mode}`),
    ]),
  ) as Record<TokenName, Oklch>;
}

function oklchToLinearRgb([lightness, chroma, hue]: Oklch): LinearRgb {
  const hueRadians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(hueRadians);
  const b = chroma * Math.sin(hueRadians);
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  const clamp = (channel: number) => Math.max(0, Math.min(1, channel));

  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function composite(
  foreground: LinearRgb,
  background: LinearRgb,
  alpha: number,
): LinearRgb {
  return foreground.map(
    (channel, index) => channel * alpha + background[index]! * (1 - alpha),
  ) as unknown as LinearRgb;
}

function relativeLuminance([red, green, blue]: LinearRgb): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left: LinearRgb, right: LinearRgb): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function assertContrast(
  theme: ThemeName,
  foregroundName: string,
  foreground: LinearRgb,
  backgroundName: string,
  background: LinearRgb,
): void {
  const ratio = contrast(foreground, background);
  assert.ok(
    ratio >= minimumTextContrast,
    `${theme} ${foregroundName} on ${backgroundName} contrast ${ratio.toFixed(2)}:1 is below ${minimumTextContrast}:1`,
  );
}

const colorThemes = ["nerve", "rose", "solar", "midnight"] as const;
const colorModes = ["light", "dark"] as const;

const themes = Object.fromEntries(
  colorThemes.flatMap((theme) =>
    colorModes.map((mode) => [`${theme}-${mode}`, parseTokens(theme, mode)]),
  ),
) as Record<ThemeName, Record<TokenName, Oklch>>;

const filledPairs = [
  ["primary", "primary-foreground"],
  ["muted", "foreground"],
  ["success", "success-foreground"],
  ["warning", "warning-foreground"],
  ["info", "info-foreground"],
  ["destructive", "destructive-foreground"],
  ["destructive-solid", "destructive-solid-foreground"],
] as const;
const semanticTokens = ["success", "warning", "info", "destructive"] as const;
/* Every surface an app chrome or content layer can sit on. `panel` is the
 * movable-panel chrome and `well` is the recessed output surface; both pair with
 * the global foreground tokens rather than owning their own. */
const surfaceTokens = [
  "background",
  "card",
  "popover",
  "panel",
  "well",
] as const;
const subtleSurfaceAlpha = 0.08;
/* Surfaces stay subdued, but a theme's hue has to be visible in its chrome to
 * be a theme rather than an accent swap; these are the ceilings that keep the
 * commitment from tipping into a tint bath. */
const maximumSurfaceChroma: Record<ColorMode, number> = {
  light: 0.03,
  dark: 0.05,
};
const minimumPrimaryChroma = 0.09;

function oklabOf([lightness, chroma, hue]: Oklch): readonly [
  number,
  number,
  number,
] {
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

function oklabDistance(left: Oklch, right: Oklch): number {
  const a = oklabOf(left);
  const b = oklabOf(right);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* Code role tokens are shared by the transcript's Shiki theme and the editor's
 * CodeMirror highlight style, so they are held to the same readability bar as
 * chrome text. Every theme must define a complete light/dark palette. */
const syntaxRoles = [
  "plain",
  "variable",
  "punctuation",
  "comment",
  "keyword",
  "string",
  "number",
  "function",
  "type",
  "property",
  "added",
  "removed",
  "changed",
  "link",
] as const;
type SyntaxRole = (typeof syntaxRoles)[number];
/* Roles that colour ordinary code side by side. Diff and link roles are excluded:
 * they carry their own meaning and never compete for identification. */
const distinguishableSyntaxRoles = [
  "keyword",
  "string",
  "number",
  "function",
  "type",
  "property",
  "comment",
] as const;
const minimumSyntaxRoleDistance = 0.08;

function parseSyntaxRoles(
  theme: ColorTheme,
  mode: ColorMode,
): Record<SyntaxRole, Oklch> {
  const block = themeBlock(theme, mode);
  return Object.fromEntries(
    syntaxRoles.map((role) => [
      role,
      resolveOklch(block, `syntax-${role}`, `${theme} ${mode}`),
    ]),
  ) as Record<SyntaxRole, Oklch>;
}

describe("syntax palette", () => {
  it("keeps every code role readable on the surfaces code blocks sit on", () => {
    for (const theme of colorThemes) {
      for (const mode of colorModes) {
        const roles = parseSyntaxRoles(theme, mode);
        const tokens = themes[`${theme}-${mode}`];
        for (const role of syntaxRoles) {
          for (const surfaceName of ["well", "card", "background"] as const) {
            assertContrast(
              `${theme}-${mode}`,
              `syntax-${role}`,
              oklchToLinearRgb(roles[role]),
              surfaceName,
              oklchToLinearRgb(tokens[surfaceName]),
            );
          }
        }
      }
    }
  });

  it("keeps code roles telling apart at a glance", () => {
    for (const theme of colorThemes) {
      for (const mode of colorModes) {
        const roles = parseSyntaxRoles(theme, mode);
        for (const [index, left] of distinguishableSyntaxRoles.entries()) {
          for (const right of distinguishableSyntaxRoles.slice(index + 1)) {
            const distance = oklabDistance(roles[left], roles[right]);
            assert.ok(
              distance >= minimumSyntaxRoleDistance,
              `${theme}-${mode} syntax roles ${left} and ${right} differ by ${distance.toFixed(3)}, below the ${minimumSyntaxRoleDistance} needed to read as different roles`,
            );
          }
        }
      }
    }
  });

  it("reserves hue for meaningful tokens", () => {
    // Identifiers and punctuation are the most common tokens on screen; giving
    // them chroma turns a code block into noise no matter how good the hues are.
    for (const theme of colorThemes) {
      for (const mode of colorModes) {
        const roles = parseSyntaxRoles(theme, mode);
        for (const role of ["plain", "variable", "punctuation"] as const) {
          assert.ok(
            roles[role][1] <= 0.04,
            `${theme}-${mode} syntax-${role} chroma ${roles[role][1]} is too saturated for a token this frequent`,
          );
        }
      }
    }
  });
});

describe("theme text contrast", () => {
  it("keeps filled semantic token pairs at WCAG AA contrast", () => {
    for (const [themeName, tokens] of Object.entries(themes) as [
      ThemeName,
      Record<TokenName, Oklch>,
    ][]) {
      for (const [backgroundName, foregroundName] of filledPairs) {
        assertContrast(
          themeName,
          foregroundName,
          oklchToLinearRgb(tokens[foregroundName]),
          backgroundName,
          oklchToLinearRgb(tokens[backgroundName]),
        );
      }
    }
  });

  it("keeps semantic text readable on every subtle badge surface", () => {
    for (const [themeName, tokens] of Object.entries(themes) as [
      ThemeName,
      Record<TokenName, Oklch>,
    ][]) {
      for (const semanticName of semanticTokens) {
        const semantic = oklchToLinearRgb(tokens[semanticName]);
        for (const surfaceName of surfaceTokens) {
          const subtleSurface = composite(
            semantic,
            oklchToLinearRgb(tokens[surfaceName]),
            subtleSurfaceAlpha,
          );
          assertContrast(
            themeName,
            semanticName,
            semantic,
            `${semanticName}/${subtleSurfaceAlpha * 100} on ${surfaceName}`,
            subtleSurface,
          );
        }
      }
    }
  });

  it("keeps large surfaces subdued and primary accents identifiable", () => {
    for (const [themeName, tokens] of Object.entries(themes) as [
      ThemeName,
      Record<TokenName, Oklch>,
    ][]) {
      const mode: ColorMode = themeName.endsWith("-light") ? "light" : "dark";
      for (const surfaceName of surfaceTokens) {
        const chroma = tokens[surfaceName][1];
        assert.ok(
          chroma <= maximumSurfaceChroma[mode],
          `${themeName} ${surfaceName} chroma ${chroma} exceeds the subdued ${mode} surface limit ${maximumSurfaceChroma[mode]}`,
        );
      }
      assert.ok(
        tokens.primary[1] >= minimumPrimaryChroma,
        `${themeName} primary chroma ${tokens.primary[1]} is below the identifiable accent minimum ${minimumPrimaryChroma}`,
      );
    }
  });

  it("keeps surface tokens on the correct side of their foreground", () => {
    // A surface that is lighter than its own foreground in dark mode (or darker
    // in light mode) is semantically inverted: it reads as an emphasized fill
    // rather than a subdued one, even though it still passes contrast.
    const surfacePairs = [
      ["background", "foreground"],
      ["card", "card-foreground"],
      ["popover", "popover-foreground"],
      ["panel", "foreground"],
      ["well", "foreground"],
    ] as const;

    for (const [themeName, tokens] of Object.entries(themes) as [
      ThemeName,
      Record<TokenName, Oklch>,
    ][]) {
      const mode: ColorMode = themeName.endsWith("-light") ? "light" : "dark";
      for (const [surfaceName, foregroundName] of surfacePairs) {
        const surface = tokens[surfaceName][0];
        const foreground = tokens[foregroundName][0];
        const inverted =
          mode === "dark" ? surface > foreground : surface < foreground;
        assert.ok(
          !inverted,
          `${themeName} ${surfaceName} lightness ${surface} is inverted against ${foregroundName} ${foreground} for ${mode} mode`,
        );
      }
    }
  });

  it("gives every theme its own semantic palette", () => {
    for (const mode of colorModes) {
      for (const token of semanticTokens) {
        const seen = new Map<string, ColorTheme>();
        for (const theme of colorThemes) {
          const value = themes[`${theme}-${mode}`][token].join(" ");
          const owner = seen.get(value);
          assert.ok(
            owner === undefined,
            `${theme}-${mode} shares its --${token} value with ${owner}-${mode}; status color is where a theme's identity is most visible`,
          );
          seen.set(value, theme);
        }
      }
    }
  });

  it("keeps the surface hierarchy legible in the legacy themes", () => {
    // Chrome-vs-workspace and the hover/selected fills are the steps a reader
    // relies on to tell regions apart, and contrast ratio compresses badly at
    // low luminance, so these are measured as perceptual lightness deltas.
    // Rosé and Solar originally derived `muted` and `accent` from adjacent
    // ladder steps, which flattened selected rows and panel edges.
    // Nerve moved to the ordered ladder model and is covered by "surface
    // ladder" below; this table describes the legacy layout (quiet fills
    // darker than the background) and is removed with those themes.
    const minimumStep: Record<string, number> = {
      "panel/background": 0.025,
      "background/muted": 0.028,
      "background/accent": 0.045,
      "background/card": 0.018,
      "card/popover": 0.015,
      "well/panel": 0.012,
    };

    for (const [themeName, tokens] of Object.entries(themes) as [
      ThemeName,
      Record<TokenName, Oklch>,
    ][]) {
      if (themeName.startsWith("nerve-")) continue;
      for (const [step, minimum] of Object.entries(minimumStep)) {
        const [lower, upper] = step.split("/") as [TokenName, TokenName];
        const delta = Math.abs(tokens[lower][0] - tokens[upper][0]);
        assert.ok(
          delta >= minimum,
          `${themeName} ${step} lightness delta ${delta.toFixed(3)} is below ${minimum}; the two surfaces will read as one`,
        );
      }
    }
  });

  it("uses the measured token pairs and tint in the shared badge", () => {
    assert.match(
      badgeSource,
      /neutral:\s*"[^"]*bg-muted text-foreground[^"]*"/,
    );
    for (const token of semanticTokens) {
      assert.match(
        badgeSource,
        new RegExp(`bg-${token}/${subtleSurfaceAlpha * 100} text-${token}`),
      );
    }
  });
});

/* The ordered-ladder model (proposal section 2). Only Nerve follows it so far;
 * the other themes are retired or migrated in later rollout steps, which will
 * widen `ladderThemes`. */
const ladderThemes = ["nerve"] as const;
const ladderTokenNames = [
  "well",
  "panel",
  "background",
  "card",
  "popover",
] as const;
const minimumLadderStep: Record<ColorMode, number> = {
  light: 0.008,
  dark: 0.018,
};
const minimumQuietFillStep = 0.012;
const minimumBorderContrast = 1.3;
const minimumInputContrast = 1.6;
const ladderExtraTokens = ["muted-foreground", "border", "input"] as const;

function ladderTokens(
  theme: ColorTheme,
  mode: ColorMode,
): Record<TokenName | (typeof ladderExtraTokens)[number], Oklch> {
  const block = themeBlock(theme, mode);
  return {
    ...themes[`${theme}-${mode}`],
    ...Object.fromEntries(
      ladderExtraTokens.map((name) => [
        name,
        resolveOklch(block, name, `${theme} ${mode}`),
      ]),
    ),
  } as Record<TokenName | (typeof ladderExtraTokens)[number], Oklch>;
}

describe("surface ladder", () => {
  it("lightens surfaces strictly in order with a minimum step", () => {
    for (const theme of ladderThemes) {
      for (const mode of colorModes) {
        const tokens = ladderTokens(theme, mode);
        for (const [index, lower] of ladderTokenNames.slice(0, -1).entries()) {
          const upper = ladderTokenNames[index + 1]!;
          const delta = tokens[upper][0] - tokens[lower][0];
          assert.ok(
            delta >= minimumLadderStep[mode],
            `${theme}-${mode} ${lower} -> ${upper} lightness step ${delta.toFixed(3)} is below ${minimumLadderStep[mode]}`,
          );
        }
      }
    }
  });

  it("places quiet fills beyond the ladder, on the foreground side", () => {
    for (const theme of ladderThemes) {
      const dark = ladderTokens(theme, "dark");
      assert.ok(
        dark.muted[0] - dark.popover[0] >= minimumQuietFillStep,
        `${theme}-dark muted must sit above popover`,
      );
      assert.ok(
        dark.accent[0] - dark.muted[0] >= minimumQuietFillStep,
        `${theme}-dark accent must sit above muted`,
      );
      const light = ladderTokens(theme, "light");
      assert.ok(
        light.muted[0] - light.accent[0] >= minimumQuietFillStep,
        `${theme}-light muted must sit above accent`,
      );
      assert.ok(
        light.well[0] - light.muted[0] >= minimumQuietFillStep,
        `${theme}-light well must sit above muted`,
      );
    }
  });

  it("keeps border and input visible on content surfaces", () => {
    for (const theme of ladderThemes) {
      for (const mode of colorModes) {
        const tokens = ladderTokens(theme, mode);
        for (const surface of ["background", "card", "popover"] as const) {
          const surfaceRgb = oklchToLinearRgb(tokens[surface]);
          for (const [name, minimum] of [
            ["border", minimumBorderContrast],
            ["input", minimumInputContrast],
          ] as const) {
            const ratio = contrast(oklchToLinearRgb(tokens[name]), surfaceRgb);
            assert.ok(
              ratio >= minimum,
              `${theme}-${mode} ${name} on ${surface} contrast ${ratio.toFixed(2)}:1 is below ${minimum}:1`,
            );
          }
        }
      }
    }
  });

  it("keeps muted text readable on the quiet fills", () => {
    for (const theme of ladderThemes) {
      for (const mode of colorModes) {
        const tokens = ladderTokens(theme, mode);
        for (const fill of ["muted", "accent"] as const) {
          assertContrast(
            `${theme}-${mode}`,
            "muted-foreground",
            oklchToLinearRgb(tokens["muted-foreground"]),
            fill,
            oklchToLinearRgb(tokens[fill]),
          );
        }
      }
    }
  });
});

describe("token structure", () => {
  const forbiddenInThemeBlocks = [
    "radius",
    "elevation-hsl",
    "elevation-strength",
    "card-foreground",
    "popover-foreground",
    "accent-foreground",
    "syntax-added",
    "syntax-removed",
    "syntax-changed",
    "syntax-link",
  ] as const;

  it("keeps themes colour-only and leaves aliases to the global block", () => {
    for (const theme of colorThemes) {
      for (const mode of colorModes) {
        const block = themeBlock(theme, mode);
        for (const name of forbiddenInThemeBlocks) {
          assert.equal(
            declarationOf(block, name),
            undefined,
            `${theme} ${mode} must not set --${name}; it is global or an alias`,
          );
        }
      }
    }
  });

  it("declares geometry and elevation once, globally", () => {
    const root = themeCss.match(/^:root\s*\{([\s\S]*?)\n\}/m)?.[1] ?? "";
    assert.equal(declarationOf(root, "radius"), "0.375rem");
    assert.equal(declarationOf(root, "elevation-strength"), "1");
    assert.ok(declarationOf(globalBlock(), "elevation-hsl"));
    assert.ok(
      /\.dark,\s*\[data-theme-preview\]\[data-color-mode="dark"\]\s*\{[^}]*--elevation-hsl:/.test(
        themeCss,
      ),
      "dark elevation colour must be declared for .dark and dark previews",
    );
  });

  it("points text and diff aliases at their source tokens", () => {
    const global = globalBlock();
    for (const name of ["card", "popover", "accent"]) {
      assert.equal(
        declarationOf(global, `${name}-foreground`),
        "var(--foreground)",
      );
    }
    assert.equal(declarationOf(global, "syntax-added"), "var(--success)");
    assert.equal(declarationOf(global, "syntax-removed"), "var(--destructive)");
    assert.equal(declarationOf(global, "syntax-changed"), "var(--warning)");
    assert.equal(declarationOf(global, "syntax-link"), "var(--info)");
  });

  it("declares derived state tokens per preview root", () => {
    const global = globalBlock();
    for (const name of ["hover", "input-background", "chrome-track"]) {
      assert.ok(
        declarationOf(global, name),
        `--${name} must be declared on \`:root, [data-theme-preview]\``,
      );
    }
    assert.equal(
      declarationOf(global, "chrome-track"),
      "color-mix(in oklab, var(--panel) 50%, var(--background))",
    );
  });

  it("removes the dark custom variant", () => {
    assert.doesNotMatch(themeCss, /@custom-variant\s+dark/);
  });
});
