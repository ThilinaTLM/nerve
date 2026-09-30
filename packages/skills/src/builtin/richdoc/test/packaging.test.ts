import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test(
  "npm packaging retains every generated CLI, renderer and font asset",
  { timeout: 30_000 },
  async () => {
    const packageRoot = resolve(import.meta.dirname, "../../../..");
    const output = execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      {
        cwd: packageRoot,
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const [packed] = JSON.parse(output) as { files: { path: string }[] }[];
    const paths = new Set(packed.files.map((file) => file.path));
    const prefix = "dist/builtin/richdoc/";
    const manifest = JSON.parse(
      await readFile(
        resolve(packageRoot, prefix, "assets/manifest.json"),
        "utf8",
      ),
    ) as { files: Record<string, unknown> };
    for (const path of [
      "SKILL.md",
      "scripts/richdoc.mjs",
      "THIRD_PARTY_NOTICES.md",
      "references/elements.md",
      "assets/manifest.json",
      ...Object.keys(manifest.files).map((name) => `assets/${name}`),
    ])
      assert.ok(paths.has(prefix + path), `Missing packed file: ${path}`);
    const notices = await readFile(
      resolve(packageRoot, prefix, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    for (const family of [
      "fraunces",
      "geist",
      "fira-code",
      "space-grotesk",
      "inter",
      "jetbrains-mono",
    ]) {
      assert.match(
        notices,
        new RegExp(`@fontsource-variable/${family}@5\\.3\\.0`),
      );
      assert.ok(
        Object.keys(manifest.files).some((path) =>
          path.startsWith(`fonts/typography/${family}-`),
        ),
        `Missing locally redistributable typography: ${family}`,
      );
    }
    assert.ok(
      ![...paths].some((path) => path.startsWith(prefix + "test/")),
      "Review screenshots and tests must not ship as document assets.",
    );
    assert.ok(
      !paths.has(prefix + ".gitignore"),
      "A source .gitignore would make npm omit generated runtime files.",
    );
  },
);
