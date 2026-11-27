import { z } from "zod";
import { uiContributionIdSchema } from "./ui-contribution-id.js";

/*
 * Theme files of extensions: data only, never CSS. A theme sets the colour inputs of one theme
 * block in `packages/ui-kit/src/styles/theme.css`; everything else (surfaces, borders, muted
 * and so on) is derived from them there. `theme-tokens.test.ts` fails when `theme.css` and this
 * list drift apart.
 */

export const bridgeThemeKindSchema = z.enum(["light", "dark"]);

/** Core colour inputs, as the custom property without its `--`. */
export const themeCoreTokens = [
  "background",
  "foreground",
  "primary",
  "success",
  "warning",
  "info",
  "destructive",
  "destructive-solid",
] as const;

/** Syntax colour roles used by both code highlighters. */
export const themeSyntaxTokens = [
  "syntax-variable",
  "syntax-punctuation",
  "syntax-comment",
  "syntax-keyword",
  "syntax-string",
  "syntax-number",
  "syntax-function",
  "syntax-type",
  "syntax-property",
] as const;

/** Tokens every theme file sets. A theme written for an older Nerve has all of them. */
export const requiredThemeTokens = [
  ...themeCoreTokens,
  ...themeSyntaxTokens,
] as const;
export type RequiredThemeTokenName = (typeof requiredThemeTokens)[number];

/**
 * Tokens added after a theme could have been written. A theme may omit them: the host fills a
 * missing one from `themeTokenDefaults`, so a new token never invalidates existing themes. Add a
 * token here and give it a default derived from the required tokens; none exist yet.
 */
export const optionalThemeTokens = [] as const;
export type OptionalThemeTokenName = (typeof optionalThemeTokens)[number];

/** Every token a theme can set, and the only ones it may set. */
export const themeTokenNames = [
  ...requiredThemeTokens,
  ...optionalThemeTokens,
] as const;
export type ThemeTokenName = (typeof themeTokenNames)[number];

type ThemeTokenDefaults = Record<
  OptionalThemeTokenName,
  (tokens: Record<RequiredThemeTokenName, string>) => string
>;

/** How a missing optional token is derived from the required ones. */
export const themeTokenDefaults: ThemeTokenDefaults = {};

/** The theme's tokens with every missing optional token filled in. */
export function completeThemeTokens(
  tokens: Record<RequiredThemeTokenName, string> &
    Partial<Record<OptionalThemeTokenName, string>>,
  defaults: Record<
    string,
    (tokens: Record<RequiredThemeTokenName, string>) => string
  > = themeTokenDefaults,
): Record<ThemeTokenName, string> {
  const filled: Record<string, string> = { ...tokens };
  for (const [name, derive] of Object.entries(defaults))
    filled[name] ??= derive(tokens);
  return filled;
}

/**
 * Per-theme tokens in `theme.css` that are not colours: lightness steps and foreground mixes
 * that a built-in theme may tune. Extension themes cannot set them (the shared defaults apply).
 */
export const themeTuningTokens = [
  "step-card",
  "step-popover",
  "step-panel",
  "step-well",
  "mix-muted",
  "mix-border",
  "mix-input",
  "mix-muted-foreground",
] as const;

export const maxThemeColorLength = 100;

/**
 * A CSS colour in a safe form: hex, or `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`, `lab()`,
 * `lch()`, `oklab()`, `oklch()` holding only numbers, units and separators. No `url()`, `var()`,
 * `calc()`, nested functions, escapes or `;`.
 */
export const themeColorSchema = z
  .string()
  .max(maxThemeColorLength)
  .refine(
    (value) =>
      /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ||
      /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[0-9.+\-%/,\s]*(?:(?:deg|rad|grad|turn|none|e)[0-9.+\-%/,\s]*)*\)$/i.test(
        value,
      ),
    {
      message:
        "must be a hex colour or an rgb/hsl/hwb/lab/lch/oklab/oklch function with plain numbers",
    },
  );

/** The theme file `dist/themes/<id>.json` (and the source file the build copies). */
export const themeFileSchema = z.strictObject({
  id: uiContributionIdSchema,
  label: z.string().trim().min(1).max(64),
  kind: bridgeThemeKindSchema,
  tokens: z
    .strictObject({
      ...(Object.fromEntries(
        requiredThemeTokens.map((name) => [name, themeColorSchema]),
      ) as Record<RequiredThemeTokenName, typeof themeColorSchema>),
      ...(Object.fromEntries(
        optionalThemeTokens.map((name) => [name, themeColorSchema.optional()]),
      ) as Record<
        OptionalThemeTokenName,
        z.ZodOptional<typeof themeColorSchema>
      >),
    })
    .transform((tokens) => completeThemeTokens(tokens)),
});
export type ThemeFile = z.infer<typeof themeFileSchema>;

/** The CSS custom-property declarations of a theme, for injection into a frame or the document. */
export function themeTokensCss(tokens: Record<ThemeTokenName, string>): string {
  return themeTokenNames.map((name) => `--${name}:${tokens[name]};`).join("");
}
