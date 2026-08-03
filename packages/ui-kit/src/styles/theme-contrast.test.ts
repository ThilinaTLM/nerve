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
type ColorTheme = "nerve" | "ocean" | "forest";
type ColorMode = "light" | "dark";
type ThemeName = `${ColorTheme}-${ColorMode}`;

const tokenNames = [
  "background",
  "card",
  "popover",
  "sidebar",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
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

const themes = Object.fromEntries(
  (["nerve", "ocean", "forest"] as const).flatMap((theme) =>
    (["light", "dark"] as const).map((mode) => [
      `${theme}-${mode}`,
      parseTokens(theme, mode),
    ]),
  ),
) as Record<ThemeName, Record<TokenName, Oklch>>;

const filledPairs = [
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "foreground"],
  ["success", "success-foreground"],
  ["warning", "warning-foreground"],
  ["info", "info-foreground"],
  ["destructive", "destructive-foreground"],
  ["destructive-solid", "destructive-solid-foreground"],
] as const;
const semanticTokens = ["success", "warning", "info", "destructive"] as const;
const surfaceTokens = ["background", "card", "popover", "sidebar"] as const;
const subtleSurfaceAlpha = 0.08;

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
