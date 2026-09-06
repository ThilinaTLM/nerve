import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Standalone documents (daemon setup pages, conversation exports, the Electron
 * loading window) cannot import the ui-kit stylesheet, so they mirror the Nerve
 * theme values. This keeps every mirror honest. */

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (...segments) => readFileSync(join(repoRoot, ...segments), "utf8");

const themeCss = read("packages", "ui-kit", "src", "styles", "theme.css");

function themeTokens(mode) {
  const selector = `[data-theme-preview="nerve"][data-color-mode="${mode}"]`;
  const block = themeCss.slice(themeCss.indexOf(selector));
  const body = block.slice(0, block.indexOf("\n}"));
  const tokens = new Map();
  for (const [, name, value] of body.matchAll(/--([\w-]+): ([^;]+);/g))
    tokens.set(name, value.trim());
  return tokens;
}

const canonical = { light: themeTokens("light"), dark: themeTokens("dark") };

describe("standalone document theme mirrors", () => {
  it("resolves the canonical nerve tokens", () => {
    for (const mode of ["light", "dark"])
      assert.ok(
        canonical[mode].size > 10,
        `expected nerve ${mode} tokens in theme.css`,
      );
  });

  it("keeps the daemon document tokens in sync with theme.css", () => {
    const source = read(
      "packages",
      "workbench-server",
      "src",
      "infrastructure",
      "documents",
      "document-theme.ts",
    );
    for (const mode of ["light", "dark"]) {
      const block = source.slice(
        source.indexOf(`${mode}: {`),
        source.indexOf("},", source.indexOf(`${mode}: {`)),
      );
      const declarations = [...block.matchAll(/"?([\w-]+)"?: "([^"]+)"/g)];
      assert.ok(declarations.length > 0, `no ${mode} tokens found`);
      for (const [, name, value] of declarations)
        assert.equal(
          value,
          canonical[mode].get(name),
          `document-theme.ts ${mode} --${name} drifted from theme.css`,
        );
    }
  });

  it("keeps the desktop loading window in sync with theme.css", () => {
    const source = read(
      "packages",
      "desktop-shell",
      "src",
      "window",
      "loading-pages.ts",
    );
    const styles = source.slice(source.indexOf("function shellStyles"));
    const darkStart = styles.indexOf("prefers-color-scheme: dark");
    const sections = {
      light: styles.slice(0, darkStart),
      dark: styles.slice(darkStart),
    };
    const mirrored = [
      "background",
      "foreground",
      "primary",
      "muted-foreground",
      "border",
      "destructive",
    ];
    for (const mode of ["light", "dark"]) {
      for (const name of mirrored) {
        const match = sections[mode].match(
          new RegExp(`--${name}: (oklch\\([^)]*\\));`),
        );
        assert.ok(match, `loading-pages.ts is missing ${mode} --${name}`);
        assert.equal(
          match[1],
          canonical[mode].get(name),
          `loading-pages.ts ${mode} --${name} drifted from theme.css`,
        );
      }
    }
  });
});
