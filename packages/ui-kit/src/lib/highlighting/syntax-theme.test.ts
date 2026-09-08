import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  currentSyntaxTheme,
  setSyntaxTheme,
  SYNTAX_THEME_PAIRS,
  syntaxTheme,
  type SyntaxTheme,
} from "./syntax-theme";
import { highlightCacheKey, SHIKI_THEME_NAMES } from "./highlight";

const themeNames = Object.keys(SYNTAX_THEME_PAIRS) as SyntaxTheme[];

describe("syntax theme binding", () => {
  it("loads every palette a theme names", () => {
    for (const theme of themeNames) {
      const pair = SYNTAX_THEME_PAIRS[theme];
      for (const name of [pair.light, pair.dark]) {
        assert.ok(
          SHIKI_THEME_NAMES.includes(name),
          `${theme} references Shiki theme '${name}', which has no loader`,
        );
      }
    }
  });

  it("gives every theme its own syntax palette", () => {
    const seen = new Map<string, SyntaxTheme>();
    for (const theme of themeNames) {
      const pair = SYNTAX_THEME_PAIRS[theme];
      const key = `${pair.light}/${pair.dark}`;
      const owner = seen.get(key);
      assert.ok(
        owner === undefined,
        `${theme} shares its syntax palette with ${owner}; code blocks would look identical in both themes`,
      );
      seen.set(key, theme);
    }
  });

  it("keys cached highlight output by theme", () => {
    // Highlighted HTML has Shiki colors baked in, so replaying a cached result
    // under a different theme would show the previous palette.
    const keys = new Set(
      themeNames.map((theme) =>
        highlightCacheKey("const a = 1", "typescript", theme),
      ),
    );
    assert.equal(keys.size, themeNames.length);
  });

  it("notifies subscribers when the active theme changes", () => {
    const seen: SyntaxTheme[] = [];
    const unsubscribe = syntaxTheme.subscribe((theme) => seen.push(theme));

    setSyntaxTheme("forest");
    setSyntaxTheme("forest");
    setSyntaxTheme("not-a-theme");
    setSyntaxTheme("ocean");

    assert.deepEqual(seen, ["nerve", "forest", "ocean"]);
    assert.equal(currentSyntaxTheme(), "ocean");

    unsubscribe();
    setSyntaxTheme("nerve");
    assert.equal(seen.length, 3);
  });
});
