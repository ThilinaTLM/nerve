import type { ThemeTokenName } from "./theme-file.js";
import { themeTokenNames } from "./theme-file.js";

/*
 * Readability rules every theme has to meet, applied to the colour inputs of a theme file (the
 * rest of a theme is derived from them in `theme.css`). `packages/ui-kit/src/styles/
 * theme-contrast.test.ts` holds the built-in themes to the same numbers with these helpers, and
 * the host runs `themeRuleProblems` when it loads an extension's themes, so a theme that would
 * fail the built-in bar never reaches the UI.
 */

/** Lightness (0..1), chroma, hue in degrees. */
export type Oklch = readonly [lightness: number, chroma: number, hue: number];
export type LinearRgb = readonly [red: number, green: number, blue: number];
export type ThemeKind = "light" | "dark";

export const minimumTextContrast = 4.5;
/** Matches `--<tone>-subtle` in theme.css. */
export const subtleSurfaceAlpha = 0.08;
/** Large surfaces stay subdued; the hue must still show. */
export const maximumSurfaceChroma: Record<ThemeKind, number> = {
  light: 0.03,
  dark: 0.05,
};
export const minimumPrimaryChroma = 0.09;
export const minimumSyntaxRoleDistance = 0.08;
export const maximumQuietSyntaxChroma = 0.04;

export const semanticThemeTokens = [
  "success",
  "warning",
  "info",
  "destructive",
] as const;
/** Syntax roles that colour ordinary code side by side and must tell apart at a glance. */
export const distinguishableSyntaxTokens = [
  "syntax-keyword",
  "syntax-string",
  "syntax-number",
  "syntax-function",
  "syntax-type",
  "syntax-property",
  "syntax-comment",
] as const;
/** Syntax roles that are the most frequent on screen and stay nearly grey. */
export const quietSyntaxTokens = [
  "syntax-variable",
  "syntax-punctuation",
] as const;

export function oklchToLinearRgb([lightness, chroma, hue]: Oklch): LinearRgb {
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

export function linearRgbToOklch([r, g, b]: LinearRgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = chroma < 1e-6 ? 0 : (Math.atan2(bb, a) * 180) / Math.PI;
  return [lightness, chroma, (hue + 360) % 360];
}

/** `foreground` over `background` at `alpha`. */
export function composite(
  foreground: LinearRgb,
  background: LinearRgb,
  alpha: number,
): LinearRgb {
  return foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha),
  ) as unknown as LinearRgb;
}

export function relativeLuminance([red, green, blue]: LinearRgb): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(left: LinearRgb, right: LinearRgb): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

export function oklabDistance(left: Oklch, right: Oklch): number {
  const lab = ([lightness, chroma, hue]: Oklch) => {
    const radians = (hue * Math.PI) / 180;
    return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
  };
  const a = lab(left);
  const b = lab(right);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The problems of a theme's colour inputs (empty: the theme passes). Every rule here is one the
 * built-in themes meet in `theme-contrast.test.ts`; a rule that needs a derived token (card,
 * panel, border) is measured there only.
 */
export function themeRuleProblemsOf(
  kind: ThemeKind,
  tokens: Record<ThemeTokenName, Oklch>,
): string[] {
  const problems: string[] = [];
  const rgb = (name: ThemeTokenName) => oklchToLinearRgb(tokens[name]);
  const text = (
    foreground: ThemeTokenName,
    label: string,
    surface: LinearRgb,
    surfaceLabel: string,
  ) => {
    const ratio = contrastRatio(rgb(foreground), surface);
    if (ratio < minimumTextContrast)
      problems.push(
        `${label} on ${surfaceLabel} has contrast ${ratio.toFixed(2)}:1, below ${minimumTextContrast}:1`,
      );
  };
  const background = rgb("background");
  text("foreground", "foreground", background, "background");
  for (const tone of semanticThemeTokens)
    text(
      tone,
      tone,
      composite(rgb(tone), background, subtleSurfaceAlpha),
      `${tone}-subtle on background`,
    );
  for (const name of themeTokenNames.filter((n) => n.startsWith("syntax-")))
    text(name, name, background, "background");

  const [backgroundLightness, backgroundChroma] = tokens.background;
  if (backgroundChroma > maximumSurfaceChroma[kind])
    problems.push(
      `background chroma ${backgroundChroma.toFixed(3)} exceeds the subdued ${kind} surface limit ${maximumSurfaceChroma[kind]}`,
    );
  const foregroundLightness = tokens.foreground[0];
  if (
    kind === "dark"
      ? backgroundLightness > foregroundLightness
      : backgroundLightness < foregroundLightness
  )
    problems.push(
      `background is ${kind === "dark" ? "lighter" : "darker"} than foreground, which inverts a ${kind} theme`,
    );
  if (tokens.primary[1] < minimumPrimaryChroma)
    problems.push(
      `primary chroma ${tokens.primary[1].toFixed(3)} is below the identifiable accent minimum ${minimumPrimaryChroma}`,
    );
  for (const [index, left] of distinguishableSyntaxTokens.entries())
    for (const right of distinguishableSyntaxTokens.slice(index + 1)) {
      const distance = oklabDistance(tokens[left], tokens[right]);
      if (distance < minimumSyntaxRoleDistance)
        problems.push(
          `${left} and ${right} differ by ${distance.toFixed(3)}, below the ${minimumSyntaxRoleDistance} needed to read as different roles`,
        );
    }
  for (const name of quietSyntaxTokens)
    if (tokens[name][1] > maximumQuietSyntaxChroma)
      problems.push(
        `${name} chroma ${tokens[name][1].toFixed(3)} is too saturated for a token this frequent (limit ${maximumQuietSyntaxChroma})`,
      );
  return problems;
}

// ── CSS colours ───────────────────────────────────────────────────────────

const srgbToLinear = (channel: number) =>
  channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);

const hueDegrees = (value: string): number => {
  const match = /^(-?[0-9.]+(?:e-?[0-9]+)?)(deg|rad|grad|turn)?$/.exec(value);
  if (!match) return NaN;
  const number = Number(match[1]);
  switch (match[2]) {
    case "rad":
      return (number * 180) / Math.PI;
    case "grad":
      return number * 0.9;
    case "turn":
      return number * 360;
    default:
      return number;
  }
};

/** A number, or a percentage mapped so that 100% is `scale`. `none` is 0. */
const amount = (value: string, scale: number): number => {
  if (value === "none") return 0;
  if (value.endsWith("%")) return (Number(value.slice(0, -1)) / 100) * scale;
  return Number(value);
};

function labToLinearRgb(l: number, a: number, b: number): LinearRgb {
  // CIE Lab (D50) → XYZ (D50) → Bradford to D65 → linear sRGB.
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (t: number) =>
    t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const x = 0.3457 / 0.3585 * inverse(fx);
  const y = l > 8 ? ((l + 16) / 116) ** 3 : l / (24389 / 27);
  const z = ((1 - 0.3457 - 0.3585) / 0.3585) * inverse(fz);
  const x65 = 0.9554734527042182 * x - 0.0230985368742614 * y + 0.0632593086610217 * z;
  const y65 = -0.0283697069632081 * x + 1.0099954580058226 * y + 0.021041398966943 * z;
  const z65 = 0.0123140016883199 * x - 0.0205076964334779 * y + 1.3303659366080753 * z;
  const clamp = (c: number) => Math.max(0, Math.min(1, c));
  return [
    clamp(3.2409699419045226 * x65 - 1.537383177570094 * y65 - 0.4986107602930034 * z65),
    clamp(-0.9692436362808796 * x65 + 1.8759675015077202 * y65 + 0.04155505740717559 * z65),
    clamp(0.05563007969699366 * x65 - 0.20397695888897652 * y65 + 1.0569715142428786 * z65),
  ];
} // prettier-ignore

function hslToSrgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/**
 * Parses a colour accepted by `themeColorSchema` into OKLCH. `undefined` for anything else, and
 * for a colour that is not fully opaque (a theme colour is a flat fill).
 */
export function parseThemeColor(value: string): Oklch | undefined {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (full.length !== 6 && full.length !== 8) return undefined;
    if (full.length === 8 && full.slice(6) !== "ff") return undefined;
    const channel = (at: number) =>
      srgbToLinear(parseInt(full.slice(at, at + 2), 16) / 255);
    return linearRgbToOklch([channel(0), channel(2), channel(4)]);
  }
  const call = /^([a-z]+)\((.*)\)$/.exec(text);
  if (!call) return undefined;
  const [, fn, body] = call;
  const slash = body.split("/");
  if (slash.length > 2) return undefined;
  const parts = slash[0].replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const alphaText =
    slash[1]?.trim() ?? (parts.length === 4 ? parts.pop() : undefined);
  if (alphaText !== undefined && amount(alphaText, 1) < 1) return undefined;
  if (parts.length !== 3) return undefined;
  const [p1, p2, p3] = parts as [string, string, string];
  let result: Oklch | undefined;
  switch (fn) {
    case "rgb":
    case "rgba": {
      const channel = (p: string) => srgbToLinear(amount(p, 255) / 255);
      result = linearRgbToOklch([channel(p1), channel(p2), channel(p3)]);
      break;
    }
    case "hsl":
    case "hsla": {
      const rgbValue = hslToSrgb(hueDegrees(p1), amount(p2, 1), amount(p3, 1));
      result = linearRgbToOklch(
        rgbValue.map(srgbToLinear) as unknown as LinearRgb,
      );
      break;
    }
    case "hwb": {
      let white = amount(p2, 1);
      let black = amount(p3, 1);
      if (white + black >= 1) {
        const grey = srgbToLinear(white / (white + black));
        result = linearRgbToOklch([grey, grey, grey]);
        break;
      }
      const base = hslToSrgb(hueDegrees(p1), 1, 0.5);
      white = Math.max(0, white);
      black = Math.max(0, black);
      result = linearRgbToOklch(
        base.map((c) =>
          srgbToLinear(c * (1 - white - black) + white),
        ) as unknown as LinearRgb,
      );
      break;
    }
    case "lab": {
      result = linearRgbToOklch(
        labToLinearRgb(amount(p1, 100), amount(p2, 125), amount(p3, 125)),
      );
      break;
    }
    case "lch": {
      const hue = (hueDegrees(p3) * Math.PI) / 180;
      const chroma = amount(p2, 150);
      result = linearRgbToOklch(
        labToLinearRgb(
          amount(p1, 100),
          chroma * Math.cos(hue),
          chroma * Math.sin(hue),
        ),
      );
      break;
    }
    case "oklab": {
      const a = amount(p2, 0.4);
      const b = amount(p3, 0.4);
      const hue = (Math.atan2(b, a) * 180) / Math.PI;
      result = [amount(p1, 1), Math.hypot(a, b), (hue + 360) % 360];
      break;
    }
    case "oklch":
      result = [amount(p1, 1), amount(p2, 0.4), hueDegrees(p3)];
      break;
  }
  return result && result.every(Number.isFinite) ? result : undefined;
}

/** `themeRuleProblemsOf` for the colour strings of a theme file. */
export function themeRuleProblems(
  kind: ThemeKind,
  tokens: Record<ThemeTokenName, string>,
): string[] {
  const parsed: Partial<Record<ThemeTokenName, Oklch>> = {};
  const problems: string[] = [];
  for (const name of themeTokenNames) {
    const color = parseThemeColor(tokens[name]);
    if (color) parsed[name] = color;
    else
      problems.push(
        `${name}: '${tokens[name]}' is not an opaque colour this host can measure`,
      );
  }
  return problems.length > 0
    ? problems
    : themeRuleProblemsOf(kind, parsed as Record<ThemeTokenName, Oklch>);
}
