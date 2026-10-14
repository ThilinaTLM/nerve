import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { loadWorkspace } from "../../testing/ci-impact.mjs";
import {
  planFocusedValidation,
  selectFocusedValidation,
} from "../focused-validation-selection.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nerve-validation-"));
  const files = new Set();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(path, content = "export {};") {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    files.add(path);
  }
  function pkg(name, dependencies = [], overrides = {}) {
    const frontend = ["workbench-app", "ui-kit", "website"].includes(name);
    const scripts =
      name === "native"
        ? {
            check: "tsc -b --pretty false && pnpm check:native",
            "check:native": "cargo fmt --check && cargo clippy",
            "fix:native": "cargo fmt",
          }
        : {
            check: frontend
              ? "svelte-check --tsconfig ./tsconfig.json"
              : "tsc -b --pretty false",
          };
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@nervekit/${name}`,
        scripts,
        exports: frontend
          ? { ".": "./src/index.ts" }
          : { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        dependencies: Object.fromEntries(
          dependencies.map((dep) => [`@nervekit/${dep}`, "workspace:*"]),
        ),
        ...overrides,
      }),
    );
    write(
      `packages/${name}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          composite: !frontend,
          noEmit: frontend,
          outDir: "dist",
        },
        include: ["src/**/*.ts"],
      }),
    );
    write(`packages/${name}/src/index.ts`);
  }
  function select(operation, paths, options = {}) {
    return selectFocusedValidation(
      root,
      operation,
      { paths, files: [...files], base: "HEAD", baseline: "fixture" },
      loadWorkspace(root),
      options,
    );
  }
  return { root, files, write, pkg, select };
}
const hasCommand = (plan, arg) =>
  plan.commands.some((command) => command.args.includes(arg));

test("app edits prepare dependency declarations and run only affected package checks", (t) => {
  const f = fixture(t);
  f.pkg("contracts");
  f.pkg("protocol", ["contracts"]);
  f.pkg("workbench-app", ["protocol"]);
  f.pkg("native");
  f.pkg("website");
  const path = "packages/workbench-app/src/index.ts";
  const plan = f.select("check", [path]);
  assert.equal(plan.mode, "focused");
  assert.deepEqual(plan.packages, ["@nervekit/workbench-app"]);
  assert.deepEqual(plan.files, { format: [path], lint: [path] });
  assert.deepEqual(plan.commands[0].args, [
    "exec",
    "tsc",
    "-b",
    "--pretty",
    "false",
    "packages/contracts/tsconfig.json",
    "packages/protocol/tsconfig.json",
  ]);
  assert.ok(hasCommand(plan, "migrations:check"));
  assert.ok(hasCommand(plan, "scripts/checks/check-package-boundaries.mjs"));
  assert.equal(hasCommand(plan, "check:native"), false);
  assert.equal(hasCommand(plan, "@nervekit/website"), false);
  assert.equal(hasCommand(plan, "build"), false);
});

test("prerequisite plan prepares dependency declarations on a clean checkout", (t) => {
  const f = fixture(t);
  f.pkg("contracts");
  f.pkg("workbench-app", ["contracts"]);
  f.write(
    "packages/contracts/tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        composite: true,
        declaration: true,
        rootDir: "src",
        outDir: "dist",
      },
      include: ["src/**/*.ts"],
    }),
  );
  const output = join(f.root, "packages/contracts/dist/index.d.ts");
  assert.equal(existsSync(output), false);
  const plan = f.select("check", ["packages/workbench-app/src/index.ts"]);
  assert.equal(plan.mode, "focused");
  const preparation = plan.commands[0];
  execFileSync(
    process.execPath,
    [resolve("node_modules/typescript/bin/tsc"), ...preparation.args.slice(2)],
    { cwd: f.root, stdio: "pipe" },
  );
  assert.equal(existsSync(output), true);
});

test("shared contracts include transitive consumers and newly added workspace packages", (t) => {
  const f = fixture(t);
  f.pkg("contracts");
  f.pkg("protocol", ["contracts"]);
  f.pkg("new-consumer", ["protocol"]);
  f.pkg("unrelated");
  const plan = f.select("check", ["packages/contracts/src/index.ts"]);
  assert.equal(plan.mode, "focused");
  assert.deepEqual(plan.packages, [
    "@nervekit/contracts",
    "@nervekit/new-consumer",
    "@nervekit/protocol",
  ]);
  assert.deepEqual(plan.commands.at(-1).args, [
    "-r",
    "--filter",
    "@nervekit/contracts",
    "--filter",
    "@nervekit/new-consumer",
    "--filter",
    "@nervekit/protocol",
    "run",
    "check",
  ]);
});

test("UI styles select website's complete package check and root input owners select consumers", (t) => {
  const f = fixture(t);
  f.pkg("ui-kit");
  f.pkg("workbench-app", ["ui-kit"]);
  f.pkg("website", [], {
    scripts: { check: "node scripts/check-content.mjs && astro check" },
  });
  f.pkg("desktop-shell");
  f.pkg("new-consumer", ["desktop-shell"]);
  f.write("packages/ui-kit/src/styles/theme.css", "");
  const style = f.select("check", ["packages/ui-kit/src/styles/theme.css"]);
  assert.equal(style.mode, "focused");
  assert.deepEqual(style.packages, [
    "@nervekit/ui-kit",
    "@nervekit/website",
    "@nervekit/workbench-app",
  ]);
  assert.ok(hasCommand(style, "check"));
  const asset = f.select("check", ["assets/brand/logo.png"]);
  assert.deepEqual(asset.packages, [
    "@nervekit/desktop-shell",
    "@nervekit/new-consumer",
  ]);
});

test("fix uses only changed targets and preserves format/lint/format order", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  const path = "packages/protocol/src/--file with spaces [1].ts";
  f.write(path);
  const plan = f.select("fix", [path]);
  assert.equal(plan.mode, "focused");
  assert.deepEqual(
    plan.commands.map((command) => command.args[1]),
    ["oxfmt", "eslint", "oxfmt"],
  );
  assert.ok(
    plan.commands.every(
      (command) => command.args.at(-1) === join(f.root, path),
    ),
  );
  assert.equal(plan.commands[1].args.includes("--fix"), true);
  assert.equal(hasCommand(plan, "tsc"), false);
});

test("Rust runs crate formatting/checks while native TS avoids Rust and still checks TS", (t) => {
  const f = fixture(t);
  f.pkg("native");
  const ts = f.select("check", ["packages/native/src/index.ts"]);
  assert.equal(ts.mode, "focused");
  assert.ok(hasCommand(ts, "tsc"));
  assert.equal(hasCommand(ts, "check:native"), false);
  assert.equal(
    hasCommand(f.select("fix", ["packages/native/src/index.ts"]), "fix:native"),
    false,
  );
  for (const path of [
    "packages/native/native/src/lib.rs",
    "packages/native/native/Cargo.toml",
    "packages/native/native/.cargo/config.toml",
    "packages/native/native/rustfmt.toml",
  ]) {
    f.write(path, "");
    assert.ok(hasCommand(f.select("fix", [path]), "fix:native"));
    assert.ok(hasCommand(f.select("check", [path]), "check:native"));
    assert.equal(f.select("check", [path]).files.lint.length, 0);
  }
});

test("deletions, package configuration, fixtures, and runtime Markdown retain package scope", (t) => {
  const f = fixture(t);
  f.pkg("skills");
  f.pkg("consumer", ["skills"]);
  for (const path of [
    "packages/skills/src/deleted.ts",
    "packages/skills/tsconfig.json",
    "packages/skills/test/fixtures/input.txt",
    "packages/skills/assets/SKILL.md",
    "packages/skills/package.json",
  ]) {
    const plan = f.select("check", [path]);
    assert.equal(plan.mode, "focused", path);
    assert.deepEqual(plan.packages, ["@nervekit/consumer", "@nervekit/skills"]);
    assert.ok(hasCommand(plan, "migrations:check"));
  }
  const deletedFix = f.select("fix", ["packages/skills/src/deleted.ts"]);
  assert.equal(deletedFix.commands.length, 0);
});

test("prose-only input formats prose but avoids global/package checks; website Markdown does not", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.pkg("website");
  f.write("docs/example.md", "# Example\n");
  f.write("packages/protocol/AGENTS.md", "# Guidance\n");
  const prose = f.select("check", [
    "docs/example.md",
    "packages/protocol/AGENTS.md",
  ]);
  assert.equal(prose.mode, "focused");
  assert.deepEqual(prose.packages, []);
  assert.equal(prose.commands.length, 1);
  assert.equal(hasCommand(prose, "migrations:check"), false);
  f.write("packages/website/src/content/docs/page.md", "# Content\n");
  assert.deepEqual(
    f.select("check", ["packages/website/src/content/docs/page.md"]).packages,
    ["@nervekit/website"],
  );
  assert.equal(f.select("check", []).mode, "none");
});

test("formatter/linter eligibility skips generated/deleted files and unsupported formats", (t) => {
  const f = fixture(t);
  f.pkg("website");
  const inputs = [
    "packages/website/src/page.astro",
    "packages/website/src/style.css",
    "packages/website/src/file.ts",
    "packages/website/dist/generated.ts",
  ];
  for (const path of inputs) f.write(path, "");
  inputs.push("packages/website/src/deleted.ts");
  const plan = f.select("check", inputs, { lintFiles: new Set() });
  assert.equal(plan.mode, "focused");
  assert.deepEqual(plan.files.format, [
    "packages/website/src/style.css",
    "packages/website/src/file.ts",
  ]);
  assert.deepEqual(plan.files.lint, []);
});

test("global/unknown inputs fall back exactly once to original full command", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  for (const path of [
    ".oxfmtrc.json",
    ".prettierignore",
    ".gitignore",
    "eslint.config.js",
    "tsconfig.base.json",
    "package.json",
    "pnpm-lock.yaml",
    "rust-toolchain.toml",
    "scripts/checks/example.mjs",
    "unowned.ts",
  ]) {
    for (const operation of ["fix", "check"]) {
      const plan = f.select(operation, [path]);
      assert.equal(plan.mode, "full", path);
      assert.deepEqual(
        plan.commands.map((command) => command.args),
        [["run", operation]],
      );
    }
  }
});

test("unsupported checks/preparation conservatively fall back instead of skipping", (t) => {
  const f = fixture(t);
  f.pkg("missing", [], { scripts: {} });
  assert.equal(
    f.select("check", ["packages/missing/src/index.ts"]).mode,
    "full",
  );
  f.pkg("custom", [], { scripts: { check: "custom-check" } });
  assert.equal(
    f.select("check", ["packages/custom/src/index.ts"]).mode,
    "full",
  );
  f.pkg("invalid-config");
  f.write(
    "packages/invalid-config/tsconfig.json",
    JSON.stringify({
      compilerOptions: { composite: true, target: "not-a-target" },
      include: ["src/**/*.ts"],
    }),
  );
  assert.equal(
    f.select("check", ["packages/invalid-config/src/index.ts"]).mode,
    "full",
  );
  f.pkg("broken");
  f.write(
    "packages/broken/tsconfig.json",
    JSON.stringify({ compilerOptions: { noEmit: true } }),
  );
  assert.equal(
    f.select("check", ["packages/broken/src/index.ts"]).mode,
    "full",
  );
});

test("file batches are bounded, preserve all targets, and never produce an empty invocation", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  const paths = Array.from(
    { length: 250 },
    (_, i) =>
      `packages/protocol/src/${String(i).padStart(3, "0")}-${"a".repeat(80)}.ts`,
  );
  for (const path of paths) f.write(path);
  const plan = f.select("fix", paths);
  const lint = plan.commands.filter((command) => command.args[1] === "eslint");
  assert.ok(lint.length > 1);
  assert.deepEqual(
    lint.flatMap((command) => command.args.slice(3)),
    paths.map((path) => join(f.root, path)),
  );
  assert.ok(
    lint.every(
      (command) =>
        command.args.length > 3 && command.args.join(" ").length < 13000,
    ),
  );
  assert.equal(f.select("fix", []).commands.length, 0);
});

test("duplicate workspace metadata cannot silently hide package checks", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.pkg("duplicate", [], { name: "@nervekit/protocol" });
  const plan = f.select("check", ["packages/protocol/src/index.ts"]);
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /workspace name/);
});

test("missing workspace dependencies yield full fallback", (t) => {
  const f = fixture(t);
  f.pkg("protocol", ["missing"]);
  const plan = f.select("check", ["packages/protocol/src/index.ts"]);
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /Unknown workspace dependency/);
});

test("planning uses ESLint's configured ignores without executing validation tools", async (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.write(
    "eslint.config.mjs",
    'export default [{ ignores: ["**/ignored.ts"] }, { files: ["**/*.ts"] }];',
  );
  f.write("packages/protocol/src/ignored.ts");
  const git = (...args) =>
    execFileSync("git", args, { cwd: f.root, stdio: "ignore" });
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "baseline",
  );
  f.write("packages/protocol/src/ignored.ts", "// changed\n");
  f.write("packages/protocol/src/index.ts", "// changed\n");
  const plan = await planFocusedValidation(f.root, "check", "HEAD");
  assert.equal(plan.mode, "focused");
  assert.deepEqual(plan.files.lint, ["packages/protocol/src/index.ts"]);
  assert.equal(plan.files.format.length, 2);
});

test("Git discovery failure produces an explicit full fallback", async (t) => {
  const f = fixture(t);
  const plan = await planFocusedValidation(f.root, "check", "does-not-exist");
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /Cannot discover validation scope/);
  assert.deepEqual(plan.commands[0].args, ["run", "check"]);
});
