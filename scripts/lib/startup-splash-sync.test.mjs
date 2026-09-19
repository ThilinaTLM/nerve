import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* The Electron shell page and the workbench bootstrap document render the same
 * startup splash. They cannot share a runtime module (desktop main-process code
 * is plain tsc output and may not depend on the workbench packages), so the
 * composition is mirrored between marker comments and verified here: any drift
 * would shift the logo during the desktop hand-off. */

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (...segments) => readFileSync(join(repoRoot, ...segments), "utf8");

const shellSource = read(
  "packages",
  "desktop-shell",
  "src",
  "window",
  "startup-splash-document.ts",
);
const webSource = read("packages", "workbench-app", "index.html");

function extract(source, begin, end) {
  const start = source.indexOf(begin);
  const stop = source.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, `missing block: ${begin}`);
  return source.slice(start + begin.length, stop);
}

const normalizeStyles = (block) =>
  block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

const normalizeMarkup = (block) =>
  block
    .replaceAll(/\s+/g, " ")
    .replaceAll(/> </g, "><")
    .replaceAll(/ (\/?)>/g, "$1>")
    .replaceAll("/>", " />")
    // The status text is host-specific: a literal in HTML, an interpolation in TS.
    .replace(
      /(<p id="startup-splash-status" aria-live="polite">).*?(<\/p>)/,
      "$1STATUS$2",
    )
    .trim();

const shellStyles = extract(
  shellSource,
  "/* startup-splash:begin */",
  "/* startup-splash:end */",
);
const webStyles = extract(
  webSource,
  "/* startup-splash:begin */",
  "/* startup-splash:end */",
);
const shellMarkup = extract(
  shellSource,
  "<!-- startup-splash:begin -->",
  "<!-- startup-splash:end -->",
);
const webMarkup = extract(
  webSource,
  "<!-- startup-splash:begin -->",
  "<!-- startup-splash:end -->",
);

describe("startup splash mirrors", () => {
  it("keeps the splash styles identical in both documents", () => {
    assert.equal(normalizeStyles(webStyles), normalizeStyles(shellStyles));
  });

  it("keeps the splash markup identical in both documents", () => {
    assert.equal(normalizeMarkup(webMarkup), normalizeMarkup(shellMarkup));
  });

  it("declares every --splash-* token the shared block references", () => {
    const referenced = new Set(
      [...shellStyles.matchAll(/var\((--splash-[\w-]+)/g)].map(
        (match) => match[1],
      ),
    );
    assert.ok(referenced.size > 3, "expected --splash-* references");
    for (const token of referenced) {
      // --splash-t0 is supplied at runtime by the desktop hand-off only.
      if (token === "--splash-t0") continue;
      for (const [name, source] of [
        [
          "loading-pages.ts",
          read(
            "packages",
            "desktop-shell",
            "src",
            "window",
            "loading-pages.ts",
          ),
        ],
        ["index.html", webSource],
      ]) {
        assert.ok(
          source.includes(`${token}:`),
          `${name} does not declare ${token}`,
        );
      }
    }
  });

  it("uses the shared DOM hooks the shell scripts target", () => {
    const loadingPages = read(
      "packages",
      "desktop-shell",
      "src",
      "window",
      "loading-pages.ts",
    );
    for (const id of ["startup-splash", "startup-splash-status"])
      assert.ok(
        loadingPages.includes(`"${id}"`),
        `loading-pages.ts does not address #${id}`,
      );
    for (const id of [
      "startup-splash",
      "startup-splash-status",
      "startup-splash-fill",
    ])
      assert.ok(
        webMarkup.includes(`id="${id}"`),
        `index.html is missing #${id}`,
      );
  });
});
