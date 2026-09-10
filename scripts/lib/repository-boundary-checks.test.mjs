import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkRepositoryBoundaries } from "../check-package-boundaries.mjs";
import { createRepositorySourceInventory } from "./repository-source-inventory.mjs";
import { workspacePackages } from "./workspace-architecture.mjs";
import { packageExportSurfaces } from "./package-export-surfaces.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nerve-boundary-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--quiet");
  for (const { directory, name } of workspacePackages) {
    write(
      `packages/${directory}/package.json`,
      JSON.stringify({
        name,
        exports: Object.fromEntries(
          packageExportSurfaces[name].map((key) => [key, "./fixture.js"]),
        ),
      }),
    );
  }
  git("add", ".");
  return { root, write, git };
}

test("accepts legal same-feature and contracts imports in a tracked fixture", (t) => {
  const { root, write, git } = fixture(t);
  write(
    "packages/workbench-app/src/lib/features/git/pr-filters.ts",
    'import type { GithubPr } from "@nervekit/contracts/git"; export type Pr = GithubPr;',
  );
  write(
    "packages/workbench-app/src/lib/features/git/index.ts",
    'export type { Pr } from "./pr-filters";',
  );
  git("add", ".");
  assert.deepEqual(checkRepositoryBoundaries(root), []);
});

test("reports forbidden package imports, retired references, style violations and owner cycles", (t) => {
  const { root, write, git } = fixture(t);
  write(
    "packages/protocol/src/example.ts",
    'import { anything } from "@nervekit/workbench-server";',
  );
  write("docs/example.md", "@nervekit/" + "agent-runtime");
  write(
    "packages/workbench-app/src/lib/presentation/Example.svelte",
    "<div>Example</div><style>@keyframes pulse { from { opacity: 0; } }</style>",
  );
  write(
    "packages/workbench-app/src/lib/app/example.ts",
    'import { feature } from "../features/tasks/index"; export const example = feature;',
  );
  write(
    "packages/workbench-app/src/lib/features/tasks/index.ts",
    'import { example } from "../../app/example"; export const feature = example;',
  );
  git("add", ".");
  const failures = checkRepositoryBoundaries(root);
  assert.ok(
    failures.includes(
      "packages/protocol/src/example.ts: @nervekit/protocol may not import @nervekit/workbench-server",
    ),
  );
  assert.ok(
    failures.includes(
      "docs/example.md: retired package/path remains: @nervekit/" +
        "agent-runtime",
    ),
  );
  assert.ok(
    failures.includes(
      "packages/workbench-app/src/lib/presentation/Example.svelte: Svelte components may not define @keyframes",
    ),
  );
  assert.ok(
    failures.some((message) =>
      message.includes("cross-owner dependency cycle: app <-> features/tasks"),
    ),
  );
  assert.deepEqual(failures, [...failures].sort());
});

test("inventory includes non-ignored untracked files, excludes deleted/ignored paths and caches reads", (t) => {
  const { root, write, git } = fixture(t);
  write("tracked.ts", "before");
  write("deleted.ts", "deleted");
  write(".gitignore", "ignored.ts\n");
  git("add", ".");
  write("untracked.ts", "untracked");
  write("ignored.ts", "ignored");
  rmSync(join(root, "deleted.ts"));
  const inventory = createRepositorySourceInventory(root);
  assert.ok(inventory.files.includes("tracked.ts"));
  assert.ok(inventory.files.includes("untracked.ts"));
  assert.ok(!inventory.files.includes("deleted.ts"));
  assert.ok(!inventory.files.includes("ignored.ts"));
  assert.equal(inventory.read("tracked.ts"), "before");
  write("tracked.ts", "after");
  assert.equal(inventory.read("tracked.ts"), "before");
});

test("CLI is silent on success and emits the sorted diagnostic report on failure", (t) => {
  const { root, write, git } = fixture(t);
  const scriptsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  cpSync(scriptsRoot, join(root, "scripts"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.mjs"),
  });
  git("add", ".");
  const run = () =>
    spawnSync(
      process.execPath,
      [join(root, "scripts/check-package-boundaries.mjs")],
      { cwd: root, encoding: "utf8" },
    );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, "");
  assert.equal(valid.stderr, "");
  write(
    "packages/protocol/src/invalid.ts",
    'import { anything } from "@nervekit/workbench-server";',
  );
  const failures = checkRepositoryBoundaries(root);
  const invalid = run();
  assert.equal(invalid.status, 1);
  assert.equal(
    invalid.stderr,
    `Package boundary check failed:\n${failures.map((message) => `- ${message}\n`).join("")}`,
  );
});
