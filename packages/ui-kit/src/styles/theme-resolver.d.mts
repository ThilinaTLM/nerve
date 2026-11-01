export type Oklch = readonly [lightness: number, chroma: number, hue: number];
export type Oklab = readonly [lightness: number, a: number, b: number];
export type ColorTheme =
  | "nerve-light"
  | "nerve-dark"
  | "melange-light"
  | "melange-dark"
  | "graphite";
export type ColorMode = "light" | "dark";

export const colorThemeKind: Readonly<Record<ColorTheme, ColorMode>>;
export function themeBlock(css: string, theme: ColorTheme): string;
export function globalBlock(css: string): string;
export function modeBlocks(css: string, mode: ColorMode): string[];
export function declarationOf(block: string, name: string): string | undefined;
export function themeLookup(
  css: string,
  theme: ColorTheme,
): (name: string) => string | undefined;
export function oklabFrom(color: Oklch): Oklab;
export function oklchFrom(lab: Oklab): Oklch;
export function resolveThemeToken(
  css: string,
  theme: ColorTheme,
  name: string,
): Oklch;
export function parseOklch(value: string): Oklch;
export function sameOklch(left: Oklch, right: Oklch): boolean;
