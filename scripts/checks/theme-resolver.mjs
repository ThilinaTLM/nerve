/* Resolves ui-kit theme tokens (`packages/ui-kit/src/styles/theme.css`) to
 * OKLCH the way the browser does, for checks that compare mirrored copies of
 * the Nerve palette. A theme block holds inputs; derived tokens come from
 * `oklch(from … calc(l + step) c h)` and oklab `color-mix()` recipes in the
 * shared blocks. Only the recipes theme.css uses are supported. */

const kind = (theme) =>
  ["nerve-dark", "graphite", "melange-dark"].includes(theme) ? "dark" : "light";

function blockAt(css, pattern) {
  const match = pattern.exec(css);
  if (!match) throw new Error(`theme.css is missing block ${pattern}`);
  const start = match.index + match[0].length;
  return css.slice(start, css.indexOf("\n}", start));
}

function declaration(block, name) {
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
}

function lookupFor(css, theme) {
  const themeBlock = blockAt(
    css,
    new RegExp(`\\[data-theme-preview="${theme}"\\]\\s*\\{`),
  );
  const light = blockAt(css, /:where\(:root, \[data-theme-preview\]\)\s*\{/);
  const dark = [
    blockAt(
      css,
      /\n\.dark,\s*\[data-theme-preview\]\[data-color-mode="dark"\]\s*\{/,
    ),
    blockAt(
      css,
      /:where\(\.dark, \[data-theme-preview\]\[data-color-mode="dark"\]\)\s*\{/,
    ),
  ];
  const shared = blockAt(css, /:root,\s*\[data-theme-preview\]\s*\{/);
  const blocks = [
    themeBlock,
    ...(kind(theme) === "dark" ? dark : []),
    light,
    shared,
  ];
  return (name) => {
    for (const block of blocks) {
      const value = declaration(block, name);
      if (value !== undefined) return value;
    }
    return undefined;
  };
}

const toLab = ([l, c, h]) => [
  l,
  c * Math.cos((h * Math.PI) / 180),
  c * Math.sin((h * Math.PI) / 180),
];
const fromLab = ([l, a, b]) => [
  l,
  Math.hypot(a, b),
  ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
];

function evaluate(value, lookup, trail = []) {
  const text = value
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")");
  const token = (name) => {
    if (trail.includes(name)) throw new Error(`Circular token --${name}`);
    const declared = lookup(name);
    if (declared === undefined) throw new Error(`Missing token --${name}`);
    return declared;
  };
  const color = (name) => evaluate(token(name), lookup, [...trail, name]);
  const number = (raw) => {
    const ref = raw.match(/^var\(--([\w-]+)\)$/);
    return parseFloat(ref ? token(ref[1]) : raw);
  };

  let m = text.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (m) return [m[1], m[2], m[3]].map(Number);
  m = text.match(/^var\(--([\w-]+)\)$/);
  if (m) return color(m[1]);
  m = text.match(
    /^oklch\(from var\(--([\w-]+)\) calc\(l \+ (var\(--[\w-]+\)|-?[\d.]+)\) c h\)$/,
  );
  if (m) {
    const [l, c, h] = color(m[1]);
    return [l + number(m[2]), c, h];
  }
  m = text.match(
    /^color-mix\(in oklab, var\(--([\w-]+)\) (var\(--[\w-]+\)|[\d.]+%), var\(--([\w-]+)\)\)$/,
  );
  if (m) {
    const share = number(m[2]) / 100;
    const near = toLab(color(m[1]));
    const far = toLab(color(m[3]));
    return fromLab(near.map((v, i) => v * share + far[i] * (1 - share)));
  }
  throw new Error(`Unsupported colour recipe "${text}"`);
}

/** Resolves `--name` for a ui-kit theme id to `[L, C, H]`. */
export function resolveThemeToken(css, theme, name) {
  const lookup = lookupFor(css, theme);
  const declared = lookup(name);
  if (declared === undefined) throw new Error(`Missing --${name} in ${theme}`);
  return evaluate(declared, lookup, [name]);
}

/** Parses an `oklch(L C H)` literal. */
export function parseOklch(value) {
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!match) throw new Error(`Not an oklch literal: ${value}`);
  return [match[1], match[2], match[3]].map(Number);
}

/** Mirrors are rounded literals, so compare with a small tolerance. */
export function sameOklch(left, right) {
  const hueGap = Math.abs(((left[2] - right[2] + 540) % 360) - 180);
  return (
    Math.abs(left[0] - right[0]) < 0.001 &&
    Math.abs(left[1] - right[1]) < 0.001 &&
    (hueGap < 0.5 || left[1] < 0.004)
  );
}
