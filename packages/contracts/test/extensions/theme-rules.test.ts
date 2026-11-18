import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contrastRatio,
  oklchToLinearRgb,
  parseThemeColor,
  themeRuleProblems,
  type ThemeTokenName,
} from "../../src/domains/extensions/index.js";

const night: Record<ThemeTokenName, string> = {
  background: "oklch(0.264 0.018 80)",
  foreground: "oklch(0.9 0.012 95)",
  primary: "oklch(0.6724 0.1308 38.8)",
  success: "oklch(0.78 0.176 149.2)",
  warning: "oklch(0.828 0.16 70.1)",
  info: "oklch(0.8 0.134 254.1)",
  destructive: "oklch(0.8 0.114 25.5)",
  "destructive-solid": "oklch(0.58 0.21 27.5)",
  "syntax-variable": "oklch(0.88 0.015 95)",
  "syntax-punctuation": "oklch(0.7 0.02 95)",
  "syntax-comment": "oklch(0.66 0.03 110)",
  "syntax-keyword": "oklch(0.76 0.13 32)",
  "syntax-string": "oklch(0.78 0.13 150)",
  "syntax-number": "oklch(0.79 0.12 315)",
  "syntax-function": "oklch(0.78 0.12 265)",
  "syntax-type": "oklch(0.8 0.09 210)",
  "syntax-property": "oklch(0.82 0.11 85)",
};

test("colours in every accepted syntax agree with each other", () => {
  const red = parseThemeColor("#ff0000")!;
  for (const text of [
    "rgb(255 0 0)",
    "rgb(100% 0% 0%)",
    "rgba(255, 0, 0, 1)",
    "hsl(0 100% 50%)",
    "hsl(0deg, 100%, 50%)",
    "hwb(0 0% 0%)",
    "lab(54.29 80.8 69.89)",
    "lch(54.29 106.84 40.85)",
    "oklab(0.628 0.2249 0.1258)",
    "oklch(0.628 0.2577 29.23)",
    "#f00",
    "#ff0000ff",
  ]) {
    const parsed = parseThemeColor(text);
    assert.ok(parsed, text);
    assert.ok(
      Math.abs(parsed[0] - red[0]) < 0.01 &&
        Math.abs(parsed[1] - red[1]) < 0.02,
      `${text}: ${parsed.join(" ")} vs ${red.join(" ")}`,
    );
  }
  assert.equal(
    parseThemeColor("#ff000080"),
    undefined,
    "translucent colours are not flat fills",
  );
  assert.equal(parseThemeColor("rgb(0 0 0 / 50%)"), undefined);
  assert.equal(parseThemeColor("red"), undefined);
});

test("black on white measures 21:1", () => {
  const black = oklchToLinearRgb(parseThemeColor("#000")!);
  const white = oklchToLinearRgb(parseThemeColor("#fff")!);
  assert.ok(Math.abs(contrastRatio(black, white) - 21) < 0.1);
});

test("a theme that meets the built-in bar has no problems", () => {
  assert.deepEqual(themeRuleProblems("dark", night), []);
});

test("each readability rule names what it found", () => {
  const problems = (kind: "light" | "dark", change: Partial<typeof night>) =>
    themeRuleProblems(kind, { ...night, ...change }).join("\n");
  assert.match(
    problems("dark", { foreground: night.background }),
    /foreground on background has contrast 1\.00:1/,
  );
  assert.match(
    problems("dark", { "syntax-comment": "oklch(0.35 0.03 110)" }),
    /syntax-comment on background/,
  );
  assert.match(
    problems("dark", { warning: "oklch(0.3 0.16 70)" }),
    /warning on warning-subtle/,
  );
  assert.match(
    problems("dark", { background: "oklch(0.3 0.12 80)" }),
    /background chroma/,
  );
  assert.match(problems("light", {}), /background is darker than foreground/);
  assert.match(
    problems("dark", { primary: "oklch(0.67 0.02 40)" }),
    /primary chroma/,
  );
  assert.match(
    problems("dark", { "syntax-string": night["syntax-keyword"] }),
    /syntax-keyword and syntax-string differ by 0\.000/,
  );
  assert.match(
    problems("dark", { "syntax-variable": "oklch(0.88 0.12 95)" }),
    /syntax-variable chroma/,
  );
  assert.match(
    problems("dark", { info: "var(--x)" }),
    /info: 'var\(--x\)' is not an opaque colour/,
  );
});
