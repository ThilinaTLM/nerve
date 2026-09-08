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

function parseTokens(
  theme: ColorTheme,
  mode: ColorMode,
): Record<TokenName, Oklch> {
  const block = themeBlock(theme, mode);
  return Object.fromEntries(
    tokenNames.map((name) => {
      const match = block.match(
        new RegExp(
          `--${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`,
        ),
      );
      assert.ok(match, `Missing OKLCH token --${name} in ${theme} ${mode}`);
      return [name, match.slice(1, 4).map(Number) as unknown as Oklch];
    }),
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

type CharacterTokens = {
  radiusRem: number;
  elevationLightness: number;
  elevationStrength: number;
};

function parseCharacter(theme: ColorTheme, mode: ColorMode): CharacterTokens {
  const block = themeBlock(theme, mode);
  const radius = block.match(/--radius:\s*([\d.]+)rem/);
  const elevation = block.match(
    /--elevation-hsl:\s*[\d.-]+\s+[\d.]+%\s+([\d.]+)%/,
  );
  const strength = block.match(/--elevation-strength:\s*([\d.]+)/);
  assert.ok(radius, `Missing --radius in ${theme} ${mode}`);
  assert.ok(elevation, `Missing --elevation-hsl in ${theme} ${mode}`);
  assert.ok(strength, `Missing --elevation-strength in ${theme} ${mode}`);
  return {
    radiusRem: Number(radius[1]),
    elevationLightness: Number(elevation[1]),
    elevationStrength: Number(strength[1]),
  };
}

const characters = Object.fromEntries(
  colorThemes.flatMap((theme) =>
    colorModes.map((mode) => [`${theme}-${mode}`, parseCharacter(theme, mode)]),
  ),
) as Record<ThemeName, CharacterTokens>;

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

function textContrastOf(tokens: Record<TokenName, Oklch>): number {
  return contrast(
    oklchToLinearRgb(tokens.foreground),
    oklchToLinearRgb(tokens.background),
  );
}

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

  it("keeps midnight darker and higher contrast than the default theme", () => {
    const maximumMidnightSurfaceLightness = 0.21;
    const minimumMidnightTextContrast = 15;

    for (const surfaceName of surfaceTokens) {
      const lightness = themes["midnight-dark"][surfaceName][0];
      assert.ok(
        lightness <= maximumMidnightSurfaceLightness,
        `midnight-dark ${surfaceName} lightness ${lightness} exceeds the low-light maximum ${maximumMidnightSurfaceLightness}`,
      );
      assert.ok(
        lightness < themes["nerve-dark"][surfaceName][0],
        `midnight-dark ${surfaceName} is not darker than nerve-dark`,
      );
    }

    for (const mode of ["light", "dark"] as const) {
      const tokens = themes[`midnight-${mode}`];
      const ratio = contrast(
        oklchToLinearRgb(tokens.foreground),
        oklchToLinearRgb(tokens.background),
      );
      assert.ok(
        ratio >= minimumMidnightTextContrast,
        `midnight-${mode} foreground on background contrast ${ratio.toFixed(2)}:1 is below the high-contrast minimum ${minimumMidnightTextContrast}:1`,
      );
    }
  });

  it("keeps every theme pair perceptibly different, not a hue swap", () => {
    // A theme earns its slot by differing in the chrome the user stares at
    // (surface color) or in overall contrast personality. Matching accents on
    // one shared grey is exactly the failure this guards against.
    const minimumBackgroundDistance = 0.03;
    const minimumContrastRatioSpread = 1.4;

    for (const mode of colorModes) {
      for (const [index, theme] of colorThemes.entries()) {
        for (const other of colorThemes.slice(index + 1)) {
          const left = themes[`${theme}-${mode}`];
          const right = themes[`${other}-${mode}`];
          const distance = oklabDistance(left.background, right.background);
          const contrasts = [textContrastOf(left), textContrastOf(right)];
          const spread = Math.max(...contrasts) / Math.min(...contrasts);
          assert.ok(
            distance >= minimumBackgroundDistance ||
              spread >= minimumContrastRatioSpread,
            `${theme} and ${other} are too alike in ${mode}: background distance ${distance.toFixed(4)} < ${minimumBackgroundDistance} and contrast spread ${spread.toFixed(2)} < ${minimumContrastRatioSpread}`,
          );
        }
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

  it("declares character tokens that actually vary between themes", () => {
    const maximumRadiusRem = 0.75;
    const maximumElevationStrength = 1.5;
    const maximumElevationLightnessPercent = 30;

    for (const [themeName, character] of Object.entries(characters) as [
      ThemeName,
      CharacterTokens,
    ][]) {
      assert.ok(
        character.radiusRem >= 0 && character.radiusRem <= maximumRadiusRem,
        `${themeName} --radius ${character.radiusRem}rem is outside [0, ${maximumRadiusRem}]`,
      );
      assert.ok(
        character.elevationStrength >= 0 &&
          character.elevationStrength <= maximumElevationStrength,
        `${themeName} --elevation-strength ${character.elevationStrength} is outside [0, ${maximumElevationStrength}]`,
      );
      if (character.elevationStrength > 0) {
        assert.ok(
          character.elevationLightness <= maximumElevationLightnessPercent,
          `${themeName} elevation lightness ${character.elevationLightness}% would wash surfaces out instead of shading them`,
        );
      }
    }

    const radii = new Set(
      colorThemes.map((theme) => characters[`${theme}-dark`].radiusRem),
    );
    assert.ok(
      radii.size >= 3,
      `only ${radii.size} distinct radii across ${colorThemes.length} themes; shape is part of a theme's character`,
    );
  });

  it("keeps the surface hierarchy legible in every theme", () => {
    // Chrome-vs-workspace and the hover/selected fills are the steps a reader
    // relies on to tell regions apart, and contrast ratio compresses badly at
    // low luminance, so these are measured as perceptual lightness deltas.
    // Rosé and Solar originally derived `muted` and `accent` from adjacent
    // ladder steps, which flattened selected rows and panel edges.
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

  it("keeps flat themes structured with visible hairlines", () => {
    // A theme that opts out of shadows has only its borders left to separate
    // surfaces, so those borders have to carry more contrast than usual.
    const minimumFlatBorderContrast = 1.35;

    for (const [themeName, character] of Object.entries(characters) as [
      ThemeName,
      CharacterTokens,
    ][]) {
      if (character.elevationStrength > 0) continue;
      const tokens = themes[themeName];
      const ratio = contrast(
        oklchToLinearRgb(tokens.border),
        oklchToLinearRgb(tokens.card),
      );
      assert.ok(
        ratio >= minimumFlatBorderContrast,
        `${themeName} is flat but its border/card contrast ${ratio.toFixed(2)}:1 is below ${minimumFlatBorderContrast}:1`,
      );
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
