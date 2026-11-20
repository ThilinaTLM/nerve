import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  completeThemeTokens,
  requiredThemeTokens,
  themeColorSchema,
  themeFileSchema,
  themeTokenNames,
  themeTuningTokens,
} from "../../src/domains/extensions/index.js";

const css = readFileSync(
  fileURLToPath(
    new URL("../../../ui-kit/src/styles/theme.css", import.meta.url),
  ),
  "utf8",
);

/** The declarations of every theme block (`[data-theme-preview="<id>"] { … }`). */
function themeBlocks(): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  for (const match of css.matchAll(
    /\[data-theme-preview="([a-z-]+)"\]\s*\{([^}]*)\}/g,
  )) {
    if (match[0].includes("data-color-mode")) continue;
    blocks.set(
      match[1]!,
      [...match[2]!.matchAll(/^\s*--([\w-]+):/gm)].map((m) => m[1]!),
    );
  }
  return blocks;
}

test("the extension theme tokens are exactly what every theme block of theme.css sets", () => {
  const blocks = themeBlocks();
  assert.ok(blocks.size >= 6, "found the theme blocks");
  const colours = [...themeTokenNames].sort();
  const tuning = new Set<string>(themeTuningTokens);
  for (const [theme, names] of blocks) {
    const own = names.filter((name) => !tuning.has(name)).sort();
    assert.deepEqual(
      own,
      colours,
      `${theme}: theme.css and themeTokenNames (contracts theme-file.ts) differ; update the list, themeTuningTokens, and the docs together`,
    );
  }
});

const tokens = Object.fromEntries(themeTokenNames.map((n) => [n, "#112233"]));
const theme = { id: "solar-dark", label: "Solar", kind: "dark", tokens };

test("a theme file needs every token and no other", () => {
  assert.equal(themeFileSchema.safeParse(theme).success, true);
  const { background, ...missing } = tokens;
  void background;
  assert.equal(
    themeFileSchema.safeParse({ ...theme, tokens: missing }).success,
    false,
  );
  assert.equal(
    themeFileSchema.safeParse({
      ...theme,
      tokens: { ...tokens, radius: "#fff" },
    }).success,
    false,
  );
  assert.equal(
    themeFileSchema.safeParse({ ...theme, kind: "dim" }).success,
    false,
  );
});

test("theme colours allow plain colour forms only", () => {
  for (const ok of [
    "#fff",
    "#11223344",
    "rgb(10 20 30 / 50%)",
    "rgba(10, 20, 30, 0.5)",
    "hsl(210 40% 50%)",
    "oklch(0.7 0.15 40)",
    "oklch(0.7 0.15 40deg)",
  ])
    assert.equal(themeColorSchema.safeParse(ok).success, true, ok);
  for (const bad of [
    "url(https://x)",
    "var(--primary)",
    "calc(1 + 1)",
    "red",
    "#12",
    "rgb(var(--x))",
    "oklch(0.7 0.1 40); color: red",
    "rgb(1 2 3) !important",
    "expression(alert(1))",
    "oklch(0.7 0.15 40" + " ".repeat(100) + ")",
  ])
    assert.equal(themeColorSchema.safeParse(bad).success, false, bad);
});

test("a token added later is filled from the required tokens; an unknown token stays an error", () => {
  const required = Object.fromEntries(
    requiredThemeTokens.map((name) => [name, "#112233"]),
  ) as Record<(typeof requiredThemeTokens)[number], string>;
  const defaults = { "new-token": (all: typeof required) => all.primary };
  assert.equal(
    completeThemeTokens(required, defaults)["new-token" as never],
    "#112233",
  );
  assert.equal(
    completeThemeTokens(
      { ...required, "new-token": "#445566" } as never,
      defaults,
    )["new-token" as never],
    "#445566",
  );
  assert.equal(
    themeFileSchema.safeParse({
      ...theme,
      tokens: { ...tokens, "not-a-token": "#112233" },
    }).success,
    false,
  );
});
