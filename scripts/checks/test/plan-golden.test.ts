// Plan-equivalence golden test: pins describePlan output of fix/check/test for synthetic
// change sets so tooling refactors cannot silently change selection. Regenerate
// intentionally with UPDATE_GOLDEN=1 and review the diff.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { describePlan as describeValidation } from "../focused-validation-runner.ts";
import { selectFocusedValidation } from "../focused-validation-selection.ts";
import { loadWorkspace } from "../../workspace/graph.ts";
import { selectFocusedTests } from "../../testing/focused-test-selection.ts";
import { describePlan as describeTests } from "../../testing/run-focused-tests.ts";

// Mirrors the `test` scripts of packages that also run colocated src tests.
const colocatedTestGlobs: Record<string, string[]> = {
  "workbench-server": [
    "test/**/*.test.ts",
    "src/{adapters,app,core-host,domains}/**/*.test.ts",
    "src/infrastructure/{configuration,events,storage-bootstrap}/**/*.test.ts",
    "src/infrastructure/process-host/!(port-inspector).test.ts",
  ],
  tools: ["test/**/*.test.ts", "src/**/*.test.ts"],
};
const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "plan-golden.json",
);

const frontend = new Set(["workbench-app", "ui-kit", "website"]);
const packages: Record<string, string[]> = {
  contracts: [],
  protocol: ["contracts"],
  tools: [],
  "workbench-server": ["contracts", "protocol"],
  "ui-kit": [],
  "workbench-app": ["contracts", "protocol", "ui-kit"],
  website: ["ui-kit"],
  native: [],
};

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), "nerve-golden-"));
  const write = (path: string, text = "export {};") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [name, deps] of Object.entries(packages)) {
    const isFrontend = frontend.has(name);
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@nervekit/${name}`,
        scripts: {
          build: isFrontend ? "vite build" : "tsc -b",
          check:
            name === "native"
              ? "tsc -b --pretty false && pnpm check:native"
              : isFrontend
                ? "svelte-check --tsconfig ./tsconfig.json"
                : "tsc -b --pretty false",
          ...(name === "native"
            ? { "check:native": "cargo fmt --check", "fix:native": "cargo fmt" }
            : {}),
          ...(name === "ui-kit" ? { "test:components": "vitest run" } : {}),
          test:
            name === "ui-kit"
              ? 'tsx --test "src/**/!(*.svelte).test.ts"'
              : name === "website"
                ? 'node --test "scripts/**/*.test.mjs"'
                : `tsx --test${name === "workbench-server" ? " --test-concurrency=1" : ""} ${(colocatedTestGlobs[name] ?? [`${isFrontend ? "src" : "test"}/**/*.test.ts`]).map((glob) => `"${glob}"`).join(" ")}${name === "native" ? " && pnpm test:native" : ""}`,
        },
        exports: isFrontend
          ? { ".": "./src/index.ts" }
          : { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        dependencies: Object.fromEntries(
          deps.map((d) => [`@nervekit/${d}`, "workspace:*"]),
        ),
      }),
    );
    write(
      `packages/${name}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: isFrontend
          ? { noEmit: true }
          : { composite: true, rootDir: "src", outDir: "dist" },
        include: ["src/**/*.ts"],
      }),
    );
    write(`packages/${name}/src/index.ts`);
    write(`packages/${name}/src/util.ts`, 'import "./index.js";');
    write(
      isFrontend
        ? `packages/${name}/src/util.test.ts`
        : `packages/${name}/test/util.test.ts`,
      isFrontend ? 'import "./util.js";' : 'import "../src/util.js";',
    );
  }
  write("packages/ui-kit/src/Button.svelte", "<script></script>");
  write(
    "packages/ui-kit/src/Button.svelte.test.ts",
    'import "./Button.svelte";',
  );
  write("scripts/checks/check-package-boundaries.ts");
  write("scripts/testing/ci-impact.ts");
  write("scripts/README.md", "# scripts");
  write("docs/guide.md", "# guide");
  write("README.md", "# readme");
  write("pnpm-lock.yaml", "lockfileVersion: 9");
  write("pnpm-workspace.yaml", "packages:\n  - packages/*");
  write(
    "package.json",
    JSON.stringify({ name: "root", scripts: { check: "x" } }),
  );
  write("tsconfig.base.json", "{}");
  write("eslint.config.js");
  write(".github/workflows/ci.yml", "name: ci");
  write("packages/workbench-server/src/storage-migrations/001.ts");
  write("packages/native/src/lib.rs", "fn main() {}");
  write("packages/native/Cargo.toml", "[package]");
  write("packages/workbench-app/src/App.svelte", "<script></script>");
  write("packages/workbench-app/src/app.css", "body{}");
  write("packages/workbench-app/src/skill.md", "# skill");
  write("packages/protocol/src/asset.md", "# asset");
  return root;
}

const changeSets: Record<string, string[]> = {
  empty: [],
  "leaf-source": ["packages/tools/src/util.ts"],
  "contracts-source": ["packages/contracts/src/index.ts"],
  "protocol-source": ["packages/protocol/src/util.ts"],
  "server-source": ["packages/workbench-server/src/index.ts"],
  "app-source": ["packages/workbench-app/src/util.ts"],
  "app-svelte": ["packages/workbench-app/src/App.svelte"],
  "app-css": ["packages/workbench-app/src/app.css"],
  "ui-kit-source": ["packages/ui-kit/src/index.ts"],
  "ui-kit-svelte": ["packages/ui-kit/src/Button.svelte"],
  "ui-kit-component-test": ["packages/ui-kit/src/Button.svelte.test.ts"],
  "website-source": ["packages/website/src/index.ts"],
  "test-only": ["packages/protocol/test/util.test.ts"],
  "native-rust": ["packages/native/src/lib.rs"],
  "native-cargo": ["packages/native/Cargo.toml"],
  "docs-only": ["docs/guide.md", "README.md"],
  "package-readme-agents": ["scripts/README.md"],
  "runtime-markdown": ["packages/workbench-app/src/skill.md"],
  "package-asset-markdown": ["packages/protocol/src/asset.md"],
  migrations: ["packages/workbench-server/src/storage-migrations/001.ts"],
  "scripts-tooling": ["scripts/checks/check-package-boundaries.ts"],
  "ci-impact-script": ["scripts/testing/ci-impact.ts"],
  lockfile: ["pnpm-lock.yaml"],
  "workspace-config": ["pnpm-workspace.yaml"],
  "root-package-json": ["package.json"],
  "tsconfig-base": ["tsconfig.base.json"],
  "eslint-config": ["eslint.config.js"],
  workflow: [".github/workflows/ci.yml"],
  "package-manifest": ["packages/protocol/package.json"],
  mixed: [
    "packages/contracts/src/index.ts",
    "packages/workbench-app/src/App.svelte",
    "docs/guide.md",
  ],
  "unknown-path": ["mystery/file.xyz"],
};

test("plan descriptions match recorded goldens", (t) => {
  const root = buildFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const listFiles = (dir = root): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? listFiles(join(dir, entry.name))
        : [relative(root, join(dir, entry.name)).replaceAll("\\", "/")],
    );
  const files = listFiles();
  const workspace = loadWorkspace(root);
  const scrub = (text: string) => text.replaceAll(root, "<root>");
  const actual: Record<string, string> = {};
  for (const [name, paths] of Object.entries(changeSets)) {
    const state = {
      paths,
      files,
      deleted: new Set<string>(),
      base: "HEAD",
      baseline: "fixture",
    };
    for (const operation of ["fix", "check"]) {
      actual[`${operation}:${name}`] = scrub(
        describeValidation(
          selectFocusedValidation(root, operation, state, workspace),
        ),
      );
    }
    actual[`test:${name}`] = scrub(
      describeTests(selectFocusedTests(root, state, workspace)),
    );
  }
  if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
    writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(readFileSync(goldenPath, "utf8"));
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected))
    assert.equal(actual[key], expected[key], key);
});
