/* Resolves ui-kit theme tokens (`theme.css`) to OKLCH the way the browser
 * does, for tests and checks that compare derived or mirrored colours. A theme
 * block holds inputs; step/mix defaults live in `:where()` mode blocks and
 * derived tokens come from the shared block. Only the recipes theme.css uses
 * are supported (`oklch()` literals, `var()` aliases, relative lightness
 * shifts, oklab `color-mix()`); anything else throws. Types: see the sibling
 * `theme-resolver.d.mts`. */

/** @typedef {readonly [lightness: number, chroma: number, hue: number]} Oklch */
/** @typedef {readonly [lightness: number, a: number, b: number]} Oklab */
/** @typedef {"nerve-light" | "nerve-dark" | "melange-light" | "melange-dark" | "graphite"} ColorTheme */
/** @typedef {"light" | "dark"} ColorMode */

/** Mirrors `colorThemeKind` in contracts: each theme is either light or dark.
 * @type {Readonly<Record<ColorTheme, ColorMode>>} */
export const colorThemeKind = Object.freeze({
  "nerve-light": "light",
  "nerve-dark": "dark",
  "melange-light": "light",
  "melange-dark": "dark",
  graphite: "dark",
});

/** @param {string} css @param {RegExp} pattern @param {string} label */
function blockAfter(css, pattern, label) {
  const match = pattern.exec(css);
  if (!match) throw new Error(`theme.css is missing ${label}`);
  const start = match.index + match[0].length;
  return css.slice(start, css.indexOf("\n}", start));
}

/** Declarations of one theme's own block (colour inputs and step overrides).
 * @param {string} css @param {ColorTheme} theme */
export function themeBlock(css, theme) {
  return blockAfter(
    css,
    new RegExp(`\\[data-theme-preview="${theme}"\\]\\s*\\{`),
    `${theme} theme block`,
  );
}

/** Declarations shared by every theme (`:root, [data-theme-preview]`).
 * @param {string} css */
export function globalBlock(css) {
  return blockAfter(
    css,
    /:root,\s*\[data-theme-preview\]\s*\{/,
    "global `:root, [data-theme-preview]` block",
  );
}

/** Mode blocks, highest precedence first: step/mix defaults (`:where(...)`,
 * zero specificity) and the dark-only globals such as `--on-solid`.
 * @param {string} css @param {ColorMode} mode */
export function modeBlocks(css, mode) {
  const light = blockAfter(
    css,
    /:where\(:root, \[data-theme-preview\]\)\s*\{/,
    ":where(:root, [data-theme-preview]) block",
  );
  if (mode === "light") return [light];
  return [
    blockAfter(
      css,
      /\n\.dark,\s*\[data-theme-preview\]\[data-color-mode="dark"\]\s*\{/,
      "dark mode globals block",
    ),
    blockAfter(
      css,
      /:where\(\.dark, \[data-theme-preview\]\[data-color-mode="dark"\]\)\s*\{/,
      ":where(.dark, …) block",
    ),
    light,
  ];
}

/** Raw value of `--name` in one block.
 * @param {string} block @param {string} name */
export function declarationOf(block, name) {
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
}

/** Cascade for one theme: its own block, then its mode's blocks, then the
 * shared block. Declarations resolve on the element that declares them, which
 * is what `var()` does when everything lives on one root.
 * @param {string} css @param {ColorTheme} theme
 * @returns {(name: string) => string | undefined} */
export function themeLookup(css, theme) {
  const blocks = [
    themeBlock(css, theme),
    ...modeBlocks(css, colorThemeKind[theme]),
    globalBlock(css),
  ];
  return (name) => {
    for (const block of blocks) {
      const value = declarationOf(block, name);
      if (value !== undefined) return value;
    }
    return undefined;
  };
}

/** @param {Oklch} color @returns {Oklab} */
export function oklabFrom([lightness, chroma, hue]) {
  const radians = (hue * Math.PI) / 180;
  return [lightness, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

/** @param {Oklab} lab @returns {Oklch} */
export function oklchFrom([lightness, a, b]) {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [lightness, Math.hypot(a, b), (hue + 360) % 360];
}

/** @param {string} value @param {(name: string) => string | undefined} lookup
 * @param {string} label @param {readonly string[]} trail @returns {Oklch} */
function evaluateColor(value, lookup, label, trail) {
  const text = value
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, /g, ",")
    .trim();
  /** @param {string} name */
  const token = (name) => {
    if (trail.includes(name))
      throw new Error(`Circular token --${name} in ${label}`);
    const declared = lookup(name);
    if (declared === undefined)
      throw new Error(`Missing token --${name} in ${label}`);
    return declared;
  };
  /** @param {string} name @returns {Oklch} */
  const colorOf = (name) =>
    evaluateColor(token(name), lookup, label, [...trail, name]);
  /** @param {string} raw @param {"" | "%"} unit */
  const numberOf = (raw, unit) => {
    const reference = raw.match(/^var\(--([\w-]+)\)$/);
    const resolved = reference ? token(reference[1]) : raw;
    const match = resolved.match(/^(-?[\d.]+)(%?)$/);
    if (!match || match[2] !== unit)
      throw new Error(`Bad number "${resolved}" in ${label}`);
    return Number(match[1]);
  };

  const literal = text.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (literal)
    return [Number(literal[1]), Number(literal[2]), Number(literal[3])];

  const alias = text.match(/^var\(--([\w-]+)\)$/);
  if (alias) return colorOf(alias[1]);

  const relative = text.match(
    /^oklch\(from var\(--([\w-]+)\) calc\(l \+ (var\(--[\w-]+\)|-?[\d.]+)\) c h\)$/,
  );
  if (relative) {
    const [lightness, chroma, hue] = colorOf(relative[1]);
    return [lightness + numberOf(relative[2], ""), chroma, hue];
  }

  const mix = text.match(
    /^color-mix\(in oklab,var\(--([\w-]+)\) (var\(--[\w-]+\)|[\d.]+%),var\(--([\w-]+)\)\)$/,
  );
  if (mix) {
    const share = numberOf(mix[2], "%") / 100;
    const near = oklabFrom(colorOf(mix[1]));
    const far = oklabFrom(colorOf(mix[3]));
    return oklchFrom([
      near[0] * share + far[0] * (1 - share),
      near[1] * share + far[1] * (1 - share),
      near[2] * share + far[2] * (1 - share),
    ]);
  }
  throw new Error(`Unsupported colour recipe "${text}" in ${label}`);
}

/** Resolves `--name` for a ui-kit theme id to `[L, C, H]`.
 * @param {string} css @param {ColorTheme} theme @param {string} name
 * @returns {Oklch} */
export function resolveThemeToken(css, theme, name) {
  const lookup = themeLookup(css, theme);
  const declared = lookup(name);
  if (declared === undefined) throw new Error(`Missing --${name} in ${theme}`);
  return evaluateColor(declared, lookup, `${theme} --${name}`, [name]);
}

/** Parses an `oklch(L C H)` literal.
 * @param {string} value @returns {Oklch} */
export function parseOklch(value) {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!match) throw new Error(`Not an oklch literal: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Mirrors are rounded literals, so compare with a small tolerance.
 * @param {Oklch} left @param {Oklch} right */
export function sameOklch(left, right) {
  const hueGap = Math.abs(((left[2] - right[2] + 540) % 360) - 180);
  return (
    Math.abs(left[0] - right[0]) < 0.001 &&
    Math.abs(left[1] - right[1]) < 0.001 &&
    (hueGap < 0.5 || left[1] < 0.004)
  );
}
