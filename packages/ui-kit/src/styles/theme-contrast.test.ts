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
type ColorTheme =
  | "nerve-light"
  | "nerve-dark"
  | "graphite"
  | "melange-light"
  | "melange-dark";
type ColorMode = "light" | "dark";
type ThemeName = ColorTheme;

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
] as const;
type TokenName = (typeof tokenNames)[number];

function themeBlock(theme: ColorTheme): string {
  const selector = `[data-theme-preview="${theme}"]`;
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = themeCss.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `Missing ${theme} theme block`);
  return match[1];
}

/* Declarations shared by every theme (`:root, [data-theme-preview]`): derived
 * tokens and aliases resolve against the theme block first, then the mode
 * blocks, then this one. */
function globalBlock(): string {
  const match = themeCss.match(
    /:root,\s*\[data-theme-preview\]\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(match, "Missing global `:root, [data-theme-preview]` block");
  return match[1];
}

/* Mode blocks: step/mix defaults (`:where(...)`, zero specificity) and the
 * dark-only globals such as `--on-solid`. */
function modeBlocks(mode: ColorMode): string[] {
  const where = (selector: string): string => {
    const match = themeCss.match(
      new RegExp(`:where\\(${selector}\\)\\s*\\{([\\s\\S]*?)\\n\\}`),
    );
    assert.ok(match, `Missing :where(${selector}) block`);
    return match[1];
  };
  const light = where(":root, \\[data-theme-preview\\]");
  if (mode === "light") return [light];
  const darkGlobals = themeCss.match(
    /\n\.dark,\s*\[data-theme-preview\]\[data-color-mode="dark"\]\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(darkGlobals, "Missing dark mode globals block");
  return [
    darkGlobals[1],
    where('\\.dark, \\[data-theme-preview\\]\\[data-color-mode="dark"\\]'),
    light,
  ];
}

function declarationOf(block: string, name: string): string | undefined {
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
}

/* Cascade for one theme: its own block, then its mode's blocks, then the
 * shared block. Declarations are resolved on the element that declares them,
 * which is what `var()` does when everything lives on one root. */
function lookupFor(theme: ColorTheme): (name: string) => string | undefined {
  const blocks = [
    themeBlock(theme),
    ...modeBlocks(colorThemeKind[theme]),
    globalBlock(),
  ];
  return (name) => {
    for (const block of blocks) {
      const value = declarationOf(block, name);
      if (value !== undefined) return value;
    }
    return undefined;
  };
}

function oklabFrom([lightness, chroma, hue]: Oklch): readonly [
  number,
  number,
  number,
] {
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

function oklchFrom([lightness, a, b]: readonly [
  number,
  number,
  number,
]): Oklch {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [lightness, Math.hypot(a, b), (hue + 360) % 360];
}

/* Evaluates the three colour recipes theme.css uses: `oklch()` literals,
 * `var()` aliases, relative lightness shifts of another token, and oklab
 * `color-mix()` of two tokens. Anything else fails loudly. */
function evaluateColor(
  value: string,
  lookup: (name: string) => string | undefined,
  label: string,
  trail: readonly string[] = [],
): Oklch {
  const text = value.replace(/\s+/g, " ").trim();
  const token = (name: string): string => {
    assert.ok(!trail.includes(name), `Circular token --${name} in ${label}`);
    const declared = lookup(name);
    assert.ok(declared !== undefined, `Missing token --${name} in ${label}`);
    return declared;
  };
  const colorOf = (name: string): Oklch =>
    evaluateColor(token(name), lookup, label, [...trail, name]);
  const numberOf = (text: string, unit: "" | "%"): number => {
    const reference = text.match(/^var\(--([\w-]+)\)$/);
    const raw = reference ? token(reference[1]!) : text;
    const match = raw.match(/^(-?[\d.]+)(%?)$/);
    assert.ok(match && match[2] === unit, `Bad number "${raw}" in ${label}`);
    return Number(match[1]);
  };

  const literal = text.match(/^oklch\( ?([\d.]+) ([\d.]+) ([\d.]+) ?\)$/);
  if (literal) return literal.slice(1, 4).map(Number) as unknown as Oklch;

  const alias = text.match(/^var\(--([\w-]+)\)$/);
  if (alias) return colorOf(alias[1]!);

  const relative = text.match(
    /^oklch\(from var\(--([\w-]+)\) calc\(l \+ (var\(--[\w-]+\)|-?[\d.]+)\) c h\)$/,
  );
  if (relative) {
    const [lightness, chroma, hue] = colorOf(relative[1]!);
    return [lightness + numberOf(relative[2]!, ""), chroma, hue];
  }

  const mix = text.match(
    /^color-mix\( ?in oklab, var\(--([\w-]+)\) (var\(--[\w-]+\)|[\d.]+%), ?var\(--([\w-]+)\) ?\)$/,
  );
  if (mix) {
    const share = numberOf(mix[2]!, "%") / 100;
    const near = oklabFrom(colorOf(mix[1]!));
    const far = oklabFrom(colorOf(mix[3]!));
    return oklchFrom([
      near[0] * share + far[0] * (1 - share),
      near[1] * share + far[1] * (1 - share),
      near[2] * share + far[2] * (1 - share),
    ]);
  }
  assert.fail(`Unsupported colour recipe "${text}" in ${label}`);
}

function resolveOklch(theme: ColorTheme, name: string): Oklch {
  const lookup = lookupFor(theme);
  const declared = lookup(name);
  assert.ok(declared !== undefined, `Missing token --${name} in ${theme}`);
  return evaluateColor(declared, lookup, `${theme} --${name}`, [name]);
}

function parseTokens(theme: ColorTheme): Record<TokenName, Oklch> {
  return Object.fromEntries(
    tokenNames.map((name) => [name, resolveOklch(theme, name)]),
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

/* Mirrors `colorThemeKind` in contracts: each theme is either light or dark. */
const colorThemeKind: Record<ColorTheme, ColorMode> = {
  "nerve-light": "light",
  "nerve-dark": "dark",
  graphite: "dark",
  "melange-light": "light",
  "melange-dark": "dark",
};
const colorThemes = Object.keys(colorThemeKind) as ColorTheme[];

const themes = Object.fromEntries(
  colorThemes.map((theme) => [theme, parseTokens(theme)]),
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
/* Matches `--<tone>-subtle` in theme.css (asserted below). */
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

function parseSyntaxRoles(theme: ColorTheme): Record<SyntaxRole, Oklch> {
  return Object.fromEntries(
    syntaxRoles.map((role) => [role, resolveOklch(theme, `syntax-${role}`)]),
  ) as Record<SyntaxRole, Oklch>;
}

describe("syntax palette", () => {
  it("keeps every code role readable on the surfaces code blocks sit on", () => {
    for (const theme of colorThemes) {
      {
        const roles = parseSyntaxRoles(theme);
        const tokens = themes[theme];
        for (const role of syntaxRoles) {
          for (const surfaceName of ["well", "card", "background"] as const) {
            assertContrast(
              theme,
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
      {
        const roles = parseSyntaxRoles(theme);
        for (const [index, left] of distinguishableSyntaxRoles.entries()) {
          for (const right of distinguishableSyntaxRoles.slice(index + 1)) {
            const distance = oklabDistance(roles[left], roles[right]);
            assert.ok(
              distance >= minimumSyntaxRoleDistance,
              `${theme} syntax roles ${left} and ${right} differ by ${distance.toFixed(3)}, below the ${minimumSyntaxRoleDistance} needed to read as different roles`,
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
      {
        const roles = parseSyntaxRoles(theme);
        for (const role of ["plain", "variable", "punctuation"] as const) {
          assert.ok(
            roles[role][1] <= 0.04,
            `${theme} syntax-${role} chroma ${roles[role][1]} is too saturated for a token this frequent`,
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
            `${semanticName}-subtle on ${surfaceName}`,
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
      const mode = colorThemeKind[themeName];
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
      const mode = colorThemeKind[themeName];
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

  it("gives graphite its own status palette", () => {
    for (const token of semanticTokens) {
      assert.notEqual(
        themes.graphite[token].join(" "),
        themes["nerve-dark"][token].join(" "),
        `graphite shares --${token} with nerve-dark`,
      );
    }
  });

  it("uses the measured token pairs and tint in the shared badge", () => {
    assert.match(
      badgeSource,
      /neutral:\s*"[^"]*bg-muted text-muted-foreground[^"]*"/,
    );
    for (const token of semanticTokens) {
      assert.match(badgeSource, new RegExp(`bg-${token}-subtle text-${token}`));
    }
  });
});

/* The ordered-ladder model (proposal section 2) applies to every theme. */
const ladderThemes = colorThemes;
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
): Record<TokenName | (typeof ladderExtraTokens)[number], Oklch> {
  return {
    ...themes[theme],
    ...Object.fromEntries(
      ladderExtraTokens.map((name) => [name, resolveOklch(theme, name)]),
    ),
  } as Record<TokenName | (typeof ladderExtraTokens)[number], Oklch>;
}

describe("surface ladder", () => {
  it("lightens surfaces strictly in order with a minimum step", () => {
    for (const theme of ladderThemes) {
      const mode = colorThemeKind[theme];
      const tokens = ladderTokens(theme);
      for (const [index, lower] of ladderTokenNames.slice(0, -1).entries()) {
        const upper = ladderTokenNames[index + 1]!;
        const delta = tokens[upper][0] - tokens[lower][0];
        assert.ok(
          delta >= minimumLadderStep[mode],
          `${theme} ${lower} -> ${upper} lightness step ${delta.toFixed(3)} is below ${minimumLadderStep[mode]}`,
        );
      }
    }
  });

  it("places quiet fills beyond the ladder, on the foreground side", () => {
    for (const theme of ladderThemes) {
      const tokens = ladderTokens(theme);
      if (colorThemeKind[theme] === "dark") {
        assert.ok(
          tokens.muted[0] - tokens.popover[0] >= minimumQuietFillStep,
          `${theme} muted must sit above popover`,
        );
      } else {
        assert.ok(
          tokens.well[0] - tokens.muted[0] >= minimumQuietFillStep,
          `${theme} well must sit above muted`,
        );
      }
    }
  });

  it("keeps border and input visible on content surfaces", () => {
    for (const theme of ladderThemes) {
      const tokens = ladderTokens(theme);
      for (const surface of ["background", "card", "popover"] as const) {
        const surfaceRgb = oklchToLinearRgb(tokens[surface]);
        for (const [name, minimum] of [
          ["border", minimumBorderContrast],
          ["input", minimumInputContrast],
        ] as const) {
          const ratio = contrast(oklchToLinearRgb(tokens[name]), surfaceRgb);
          assert.ok(
            ratio >= minimum,
            `${theme} ${name} on ${surface} contrast ${ratio.toFixed(2)}:1 is below ${minimum}:1`,
          );
        }
      }
    }
  });

  it("keeps muted text readable on the quiet fills", () => {
    for (const theme of ladderThemes) {
      const tokens = ladderTokens(theme);
      for (const fill of ["muted"] as const) {
        assertContrast(
          theme,
          "muted-foreground",
          oklchToLinearRgb(tokens["muted-foreground"]),
          fill,
          oklchToLinearRgb(tokens[fill]),
        );
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
      const block = themeBlock(theme);
      for (const name of forbiddenInThemeBlocks) {
        assert.equal(
          declarationOf(block, name),
          undefined,
          `${theme} must not set --${name}; it is global or an alias`,
        );
      }
    }
  });

  it("limits theme blocks to colour inputs and step overrides", () => {
    const allowed = new Set<string>([
      "background",
      "foreground",
      "primary",
      "success",
      "warning",
      "info",
      "destructive",
      "destructive-solid",
      ...syntaxRoles
        .filter(
          (role) =>
            !["plain", "added", "removed", "changed", "link"].includes(role),
        )
        .map((role) => `syntax-${role}`),
      "step-card",
      "step-popover",
      "step-panel",
      "step-well",
      "mix-muted",
      "mix-border",
      "mix-input",
      "mix-muted-foreground",
    ]);
    for (const theme of colorThemes) {
      const declared = [...themeBlock(theme).matchAll(/--([\w-]+)\s*:/g)].map(
        (match) => match[1]!,
      );
      for (const name of declared) {
        assert.ok(
          allowed.has(name),
          `${theme} declares --${name}, which is derived or global`,
        );
      }
      for (const name of [
        "background",
        "foreground",
        "primary",
        "success",
        "warning",
        "info",
        "destructive",
        "destructive-solid",
      ]) {
        assert.ok(declared.includes(name), `${theme} must declare --${name}`);
      }
    }
  });

  it("gives every theme exactly one block selected by id", () => {
    for (const theme of colorThemes) {
      const selected = themeCss.match(
        new RegExp(`:root\\[data-theme="${theme}"\\]`, "g"),
      );
      assert.equal(selected?.length, 1, `${theme} must have one root selector`);
    }
    assert.match(
      themeCss,
      /:root:not\(\[data-theme\]\),\s*:root\[data-theme="nerve-light"\]/,
    );
    assert.match(
      themeCss,
      /:root\.dark[:]not\(\[data-theme\]\),\s*:root\[data-theme="nerve-dark"\]/,
    );
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

  it("derives tone tints at the alpha the contrast checks measure", () => {
    const global = globalBlock();
    for (const token of semanticTokens) {
      assert.equal(
        declarationOf(global, `${token}-subtle`),
        `color-mix(in oklab, var(--${token}) ${subtleSurfaceAlpha * 100}%, transparent)`,
      );
    }
  });

  it("points text and diff aliases at their source tokens", () => {
    const global = globalBlock();
    for (const name of ["card", "popover"]) {
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
      "color-mix(in oklab, var(--well) 50%, var(--panel))",
    );
  });

  it("removes the dark custom variant", () => {
    assert.doesNotMatch(themeCss, /@custom-variant\s+dark/);
  });
});
