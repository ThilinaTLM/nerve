import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { loadWorkspace } from "../ci-impact.mjs";
import {
  planFocusedTests,
  readGitState,
  selectFocusedTests,
} from "../focused-test-selection.mjs";
import { createImportGraph, extractImports } from "../test-import-graph.mjs";
import {
  describePlan,
  executePlan,
  parseArguments,
} from "../run-focused-tests.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nerve-focused-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, text = "export {};") {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  function pkg(directory, dependencies = [], overrides = {}) {
    const frontend = ["ui-kit", "workbench-app"].includes(directory);
    const website = directory === "website";
    const scripts = {
      build: frontend || website ? "should-not-build" : "tsc -b",
      test: website
        ? 'node --test "scripts/**/*.test.mjs"'
        : `tsx --test${directory === "workbench-server" ? " --test-concurrency=1" : ""} "${frontend ? "src" : "test"}/**/*.test.ts"${directory === "native" ? " && pnpm test:native" : ""}`,
    };
    write(
      `packages/${directory}/package.json`,
      JSON.stringify({
        name: `@nervekit/${directory}`,
        scripts,
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./*": { types: "./dist/*.d.ts", import: "./dist/*.js" },
        },
        dependencies: Object.fromEntries(
          dependencies.map((name) => [`@nervekit/${name}`, "workspace:*"]),
        ),
        ...overrides,
      }),
    );
    write(
      `packages/${directory}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: frontend
          ? { noEmit: true, baseUrl: ".", paths: { "$lib/*": ["src/lib/*"] } }
          : { rootDir: "src", outDir: "dist" },
      }),
    );
  }
  function files(directory = root) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.name === ".git"
        ? []
        : entry.isDirectory()
          ? files(join(directory, entry.name))
          : [relative(root, join(directory, entry.name)).replaceAll("\\", "/")],
    );
  }
  function select(paths, deleted = []) {
    return selectFocusedTests(root, {
      paths,
      files: files(),
      deleted: new Set(deleted),
      base: "HEAD",
      baseline: "fixture",
    });
  }
  return { root, write, pkg, files, select };
}
const selected = (plan) =>
  plan.packages.flatMap((pkg) => pkg.tests.map((test) => test.file));

test("transitive source graph selects helpers and consumers, excluding unrelated tests and handling cycles", (t) => {
  const f = fixture(t);
  f.pkg("contracts");
  f.pkg("protocol", ["contracts"]);
  f.write("packages/contracts/src/index.ts", 'export * from "./leaf.js";');
  f.write(
    "packages/contracts/src/leaf.ts",
    'import "./index.js"; export const leaf = 1;',
  );
  f.write("packages/contracts/test/leaf.test.ts", 'import "../src/leaf.js";');
  f.write(
    "packages/protocol/test/helper.ts",
    'export * from "@nervekit/contracts";',
  );
  f.write("packages/protocol/test/consumer.test.ts", 'import "./helper.js";');
  f.write("packages/protocol/test/unrelated.test.ts");
  const plan = f.select(["packages/contracts/src/leaf.ts"]);
  assert.equal(plan.mode, "focused");
  assert.deepEqual(selected(plan), [
    "packages/contracts/test/leaf.test.ts",
    "packages/protocol/test/consumer.test.ts",
  ]);
  assert.match(
    describePlan(plan),
    /helper\.ts -> packages\/contracts\/src\/index\.ts/,
  );
  assert.equal(
    plan.commands.some((step) => step.args.includes("build:native")),
    false,
  );
  assert.deepEqual(
    plan.commands.find(
      (step) => step.reason === "prepare emitted workspace APIs",
    ).args,
    [
      "--filter",
      "@nervekit/contracts",
      "--filter",
      "@nervekit/protocol",
      "--if-present",
      "build",
    ],
  );
});

test("workspace subpaths resolve to source with stale dist and source wildcard exports", (t) => {
  const f = fixture(t);
  f.pkg("contracts");
  f.pkg("protocol", ["contracts"]);
  f.pkg("ui-kit", [], {
    exports: { "./collections/*": "./src/lib/collections/*.ts" },
  });
  f.write("packages/contracts/src/events/item.ts");
  f.write(
    "packages/contracts/dist/events/item.js",
    'import "missing-generated-output";',
  );
  f.write(
    "packages/protocol/test/item.test.ts",
    'import type { Item } from "@nervekit/contracts/events/item";',
  );
  f.write("packages/ui-kit/src/lib/collections/items.ts");
  f.write(
    "packages/protocol/test/ui.test.ts",
    'import "@nervekit/ui-kit/collections/items";',
  );
  const graph = createImportGraph(f.root, f.files(), loadWorkspace(f.root));
  assert.equal(
    graph
      .trace("packages/protocol/test/item.test.ts")
      .chains.has("packages/contracts/src/events/item.ts"),
    true,
  );
  assert.equal(
    graph
      .trace("packages/protocol/test/item.test.ts")
      .chains.has("packages/contracts/dist/events/item.js"),
    false,
  );
  assert.equal(
    graph
      .trace("packages/protocol/test/ui.test.ts")
      .chains.has("packages/ui-kit/src/lib/collections/items.ts"),
    true,
  );
});

test("aliases, extensionless index and literal dynamic svelte.js imports resolve source", (t) => {
  const f = fixture(t);
  f.pkg("workbench-app");
  f.write(
    "packages/workbench-app/src/lib/parts/index.ts",
    'export * from "../state.svelte.js";',
  );
  f.write("packages/workbench-app/src/lib/state.svelte.ts");
  f.write(
    "packages/workbench-app/src/lib/state.test.ts",
    'import "$lib/parts"; await import("./state.svelte.js");',
  );
  f.write("packages/workbench-app/src/lib/other.test.ts");
  const plan = f.select(["packages/workbench-app/src/lib/state.svelte.ts"]);
  assert.deepEqual(selected(plan), [
    "packages/workbench-app/src/lib/state.test.ts",
  ]);
  assert.equal(
    plan.commands.some((step) => step.args.includes("build")),
    false,
  );
});

test("computed imports and filesystem/process test helpers select opaque tests conservatively", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.write("packages/protocol/src/value.ts");
  f.write("packages/protocol/test/value.test.ts", 'import "../src/value.js";');
  f.write(
    "packages/protocol/test/helper.ts",
    'import { readFile } from "node:fs/promises";',
  );
  f.write("packages/protocol/test/fs.test.ts", 'import "./helper.js";');
  f.write(
    "packages/protocol/test/process.test.ts",
    'import "node:child_process";',
  );
  f.write("packages/protocol/test/dynamic.test.ts", "import(variable);");
  f.write("packages/protocol/test/unrelated.test.ts");
  const plan = f.select(["packages/protocol/src/value.ts"]);
  assert.deepEqual(selected(plan), [
    "packages/protocol/test/dynamic.test.ts",
    "packages/protocol/test/fs.test.ts",
    "packages/protocol/test/process.test.ts",
    "packages/protocol/test/value.test.ts",
  ]);
  assert.equal(plan.packages[0].fallback.length, 0);
});

test("unsupported inputs, deleted source and uncovered source fall back to owning packages and dependents", (t) => {
  const f = fixture(t);
  f.pkg("contracts");
  f.pkg("protocol", ["contracts"]);
  f.write("packages/contracts/src/value.ts");
  f.write("packages/contracts/test/a.test.ts");
  f.write("packages/protocol/test/b.test.ts");
  for (const [path, deleted] of [
    ["packages/contracts/src/value.ts", []],
    [
      "packages/contracts/src/removed.ts",
      ["packages/contracts/src/removed.ts"],
    ],
    ["packages/contracts/test/fixtures/data.json", []],
    ["packages/contracts/tsconfig.json", []],
    ["packages/contracts/src/view.svelte", []],
  ]) {
    const plan = f.select([path], deleted);
    assert.equal(plan.mode, "focused");
    assert.equal(
      plan.packages.every((pkg) => pkg.fallback.length > 0),
      true,
      path,
    );
    assert.equal(
      plan.commands.filter((step) => step.args.at(-1) === "test").length,
      2,
    );
  }
});

test("changed and new tests are always included without selecting unrelated tests", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.write("packages/protocol/test/new.test.ts");
  f.write("packages/protocol/test/old.test.ts");
  const plan = f.select(["packages/protocol/test/new.test.ts"]);
  assert.deepEqual(selected(plan), ["packages/protocol/test/new.test.ts"]);
  assert.deepEqual(plan.packages[0].tests[0].reasons, ["changed test"]);
});

test("website tests are included, documentation is skipped, and skill Markdown is runtime data", (t) => {
  const f = fixture(t);
  f.pkg("website");
  f.pkg("skills");
  f.write("packages/website/scripts/lib.mjs");
  f.write("packages/website/scripts/site.test.mjs", 'import "./lib.mjs";');
  f.write("packages/skills/test/skills.test.ts");
  assert.deepEqual(selected(f.select(["packages/website/scripts/lib.mjs"])), [
    "packages/website/scripts/site.test.mjs",
  ]);
  assert.equal(
    f.select(["README.md", "docs/guide.md", "packages/skills/AGENTS.md"]).mode,
    "none",
  );
  assert.equal(f.select([]).mode, "none");
  assert.equal(
    f.select(["packages/skills/assets/skill/SKILL.md"]).packages[0].fallback
      .length > 0,
    true,
  );
});

test("global/unknown changes and unsupported runners cannot silently skip tests", (t) => {
  const f = fixture(t);
  f.pkg("protocol", [], { scripts: { test: "custom-runner" } });
  for (const path of [
    "package.json",
    "scripts/test-selection.mjs",
    "unknown/tool.js",
    "packages/protocol/src/file.ts",
  ])
    assert.equal(f.select([path]).mode, "full");
  assert.equal(planFocusedTests(f.root, "missing-base").mode, "full");
});

test("unresolved and malformed modules are opaque rather than missing edges", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.write("packages/protocol/src/value.ts");
  f.write("packages/protocol/test/value.test.ts", 'import "../src/value.js";');
  f.write(
    "packages/protocol/test/unresolved.test.ts",
    'import "@nervekit/protocol/missing";',
  );
  f.write("packages/protocol/test/broken.test.ts", "import {");
  f.write(
    "packages/protocol/test/svelte.test.ts",
    'import "../src/view.svelte";',
  );
  f.write("packages/protocol/src/view.svelte", "<div />");
  const plan = f.select(["packages/protocol/src/value.ts"]);
  assert.equal(selected(plan).length, 4);
  assert.match(describePlan(plan), /unresolved workspace import/);
  assert.match(describePlan(plan), /parse diagnostics/);
  assert.match(describePlan(plan), /unsupported module/);
});

test("server options, skills lifecycle and native Cargo coverage survive selection", (t) => {
  const f = fixture(t);
  f.pkg("native");
  f.pkg("workbench-server", ["native"]);
  f.pkg("skills", [], {
    scripts: {
      build: "tsc -b",
      pretest: "copy-assets",
      test: 'tsx --test "test/**/*.test.ts"',
    },
  });
  f.write("packages/native/src/index.ts");
  f.write("packages/native/test/native.test.ts", 'import "../src/index.js";');
  f.write("packages/workbench-server/test/server.test.ts");
  f.write("packages/skills/test/skills.test.ts");
  const server = f.select(["packages/workbench-server/test/server.test.ts"]);
  assert.equal(server.commands[0].args[0], "build:native");
  assert.equal(
    server.commands.at(-1).args.includes("--test-concurrency=1"),
    true,
  );
  assert.equal(
    server.commands.at(-1).args.includes("test/server.test.ts"),
    true,
  );
  assert.equal(
    server.commands.at(-1).args.some((arg) => arg.includes("*")),
    false,
  );
  const skills = f.select(["packages/skills/test/skills.test.ts"]);
  assert.equal(skills.commands.at(-2).args.at(-1), "pretest");
  const native = f.select(["packages/native/src/index.ts"]);
  assert.deepEqual(native.commands.at(-1).args, [
    "--filter",
    "@nervekit/native",
    "test",
  ]);
});

test("Git discovery includes branch, staged, unstaged, untracked, and renamed paths with spaces", (t) => {
  const f = fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: f.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  f.write(".gitignore", "ignored.ts\n");
  f.write("staged.ts");
  f.write("unstaged.ts");
  f.write("old name.ts");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  f.write("branch.ts");
  git("add", ".");
  git("commit", "-qm", "branch");
  f.write("staged.ts", "export const staged = 1;");
  git("add", "staged.ts");
  f.write("unstaged.ts", "export const unstaged = 1;");
  git("mv", "old name.ts", "new name.ts");
  f.write("untracked file.ts");
  f.write("ignored.ts");
  // A staged edit undone in the worktree still belongs to staged change discovery.
  f.write("staged.ts", "export {};");
  const state = readGitState(f.root, base);
  assert.deepEqual(state.paths, [
    "branch.ts",
    "new name.ts",
    "old name.ts",
    "staged.ts",
    "unstaged.ts",
    "untracked file.ts",
  ]);
  assert.equal(state.deleted.has("old name.ts"), true);
  assert.equal(state.files.includes("old name.ts"), false);
  assert.equal(state.files.includes("ignored.ts"), false);
  assert.equal(readGitState(f.root, "HEAD").paths.includes("branch.ts"), false);
});

test("dry-run launches nothing and execution stops on prerequisite/test failure", () => {
  const plan = {
    commands: [
      { command: "pnpm", args: ["build"] },
      { command: "node", args: ["--test", "a.test.mjs"] },
    ],
  };
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    return { status: 0 };
  };
  executePlan(plan, "/tmp", { dryRun: true, spawn });
  assert.equal(calls.length, 0);
  executePlan(plan, "/tmp", { spawn });
  assert.deepEqual(
    calls.map((call) => call.slice(0, 2)),
    plan.commands.map((step) => [step.command, step.args]),
  );
  let count = 0;
  assert.throws(
    () =>
      executePlan(plan, "/tmp", {
        spawn: () => {
          count++;
          return { status: 1 };
        },
      }),
    /failed/,
  );
  assert.equal(count, 1);
  assert.throws(
    () =>
      executePlan(plan, "/tmp", {
        spawn: () => ({ status: null, signal: "SIGTERM" }),
      }),
    /SIGTERM/,
  );
  assert.throws(
    () =>
      executePlan(plan, "/tmp", {
        spawn: () => ({ error: new Error("missing runner") }),
      }),
    /missing runner/,
  );
});

test("AST recognizes re-exports, require, import-equals and computed module discovery", () => {
  const parsed = extractImports(
    'export * from "./barrel.js"; const x = require("./helper.js"); import item = require("./item.cjs"); type T = import("./type.js").T; import.meta.glob("./*.ts");',
    "test.ts",
  );
  assert.deepEqual(parsed.imports.sort(), [
    "./barrel.js",
    "./helper.js",
    "./item.cjs",
    "./type.js",
  ]);
  assert.deepEqual(parsed.warnings, ["runtime module discovery"]);
});

test("require.resolve/module.require and JSX/MTS/CTS index modules retain dependency edges", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  const modules = [
    "component.jsx",
    "esm/index.mts",
    "common/index.cts",
    "view/index.tsx",
  ];
  for (const module of modules)
    f.write(
      `packages/protocol/src/${module}`,
      module.endsWith("jsx") || module.endsWith("tsx")
        ? "export const view = <div />;"
        : "export {};",
    );
  f.write(
    "packages/protocol/test/direct.test.ts",
    'import "../src/component.js";',
  );
  f.write(
    "packages/protocol/test/resolve.test.ts",
    'require.resolve("../src/component.js");',
  );
  f.write(
    "packages/protocol/test/module.test.ts",
    'module.require("../src/component.js");',
  );
  f.write(
    "packages/protocol/test/indices.test.ts",
    'import "../src/esm"; import "../src/common"; import "../src/view";',
  );
  f.write("packages/protocol/test/unrelated.test.ts");
  assert.deepEqual(
    selected(f.select(["packages/protocol/src/component.jsx"])),
    [
      "packages/protocol/test/direct.test.ts",
      "packages/protocol/test/module.test.ts",
      "packages/protocol/test/resolve.test.ts",
    ],
  );
  const graph = createImportGraph(f.root, f.files(), loadWorkspace(f.root));
  const trace = graph.trace("packages/protocol/test/indices.test.ts");
  for (const module of modules.slice(1))
    assert.equal(trace.chains.has(`packages/protocol/src/${module}`), true);
  assert.deepEqual(trace.warnings, []);
  assert.deepEqual(
    extractImports("require.resolve(name); module.require(name);", "test.ts")
      .warnings,
    ["computed module dependency"],
  );
});

test("new workspace packages and external owned inputs are not silently omitted", (t) => {
  const f = fixture(t);
  f.pkg("extra");
  f.pkg("desktop-shell");
  f.write("packages/extra/src/value.ts");
  f.write("packages/extra/test/value.test.ts", 'import "../src/value.js";');
  f.write("packages/desktop-shell/test/desktop.test.ts");
  assert.deepEqual(selected(f.select(["packages/extra/src/value.ts"])), [
    "packages/extra/test/value.test.ts",
  ]);
  assert.equal(
    f.select(["assets/brand/icon.png"]).packages[0].fallback.length > 0,
    true,
  );
});

test("CLI rejects unknown and missing arguments", () => {
  assert.deepEqual(parseArguments(["--base", "HEAD", "--dry-run"]), {
    base: "HEAD",
    dryRun: true,
  });
  assert.throws(() => parseArguments(["--base"]), /Usage/);
  assert.throws(() => parseArguments(["--unknown"]), /Usage/);
});
