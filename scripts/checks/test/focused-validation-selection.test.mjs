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
  assert.deepEqual(plan.stages.packages.targets, ["@nervekit/workbench-app"]);
  assert.deepEqual(
    { format: plan.stages.format.targets, lint: plan.stages.lint.targets },
    { format: [path], lint: [path] },
  );
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
  assert.deepEqual(plan.stages.packages.targets, [
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
  assert.deepEqual(style.stages.packages.targets, [
    "@nervekit/ui-kit",
    "@nervekit/website",
    "@nervekit/workbench-app",
  ]);
  assert.ok(hasCommand(style, "check"));
  const asset = f.select("check", ["assets/brand/logo.png"]);
  assert.deepEqual(asset.stages.packages.targets, [
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
  assert.ok(
    ts.commands
      .find((command) => command.stage === "prepare")
      .args.includes("packages/native/tsconfig.json"),
  );
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
    assert.equal(f.select("check", [path]).stages.lint.targets.length, 0);
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
    assert.deepEqual(plan.stages.packages.targets, [
      "@nervekit/consumer",
      "@nervekit/skills",
    ]);
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
  assert.deepEqual(prose.stages.packages.targets, []);
  assert.equal(prose.commands.length, 1);
  assert.equal(hasCommand(prose, "migrations:check"), false);
  f.write("packages/website/src/content/docs/page.md", "# Content\n");
  assert.deepEqual(
    f.select("check", ["packages/website/src/content/docs/page.md"]).stages
      .packages.targets,
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
  assert.deepEqual(plan.stages.format.targets, [
    "packages/website/src/style.css",
    "packages/website/src/file.ts",
  ]);
  assert.deepEqual(plan.stages.lint.targets, []);
});

test("configuration changes produce mixed stages, not root command fallbacks", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.pkg("native");
  f.write("eslint.config.js", "export default [];");
  f.write(".oxfmtrc.json", "{}");
  const format = f.select("check", [".oxfmtrc.json"]);
  assert.equal(format.mode, "mixed");
  assert.equal(format.stages.format.scope, "all");
  assert.equal(format.stages.lint.scope, "none");
  assert.equal(format.stages.packages.scope, "none");
  assert.equal(format.stages.native.scope, "none");
  const lint = f.select("check", ["eslint.config.js"]);
  assert.equal(lint.stages.format.scope, "changed");
  assert.equal(lint.stages.lint.scope, "all");
  assert.equal(lint.stages.packages.scope, "none");
  assert.equal(lint.stages.native.scope, "none");
  assert.ok(
    hasCommand(lint, "tsc"),
    "typed lint prepares declarations independently",
  );
  const unknown = f.select("check", ["unowned.ts"]);
  assert.equal(unknown.stages.packages.scope, "all");
  assert.equal(unknown.stages.format.scope, "none");
  assert.equal(unknown.stages.lint.scope, "none");
  assert.equal(unknown.stages.native.scope, "none");
  assert.equal(hasCommand(unknown, "check:native"), false);
  assert.deepEqual(
    unknown.commands.find((command) => command.stage === "packages").args,
    ["-r", "--filter", "!@nervekit/native", "run", "check"],
  );
  assert.ok(unknown.commands.every((command) => command.stage !== "fallback"));
});

test("explicit broad config scopes work even without a changed tool-supported file", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  const format = f.select("check", [".prettierignore"]);
  assert.equal(format.stages.format.scope, "all");
  assert.deepEqual(format.stages.format.targets, ["."]);
  assert.deepEqual(
    format.commands.find((command) => command.stage === "format").args,
    ["exec", "oxfmt", "--check"],
  );
  const lint = f.select("check", [".eslintignore"]);
  assert.equal(lint.stages.lint.scope, "all");
  assert.deepEqual(
    lint.commands.find((command) => command.stage === "lint").args,
    ["exec", "eslint", "."],
  );
});

test("repository-wide lint autofix gets a final repository-wide formatting pass", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.write("eslint.config.js", "export default [];");
  const plan = f.select("fix", ["eslint.config.js"]);
  assert.equal(plan.stages.format.scope, "all");
  assert.equal(plan.stages.lint.scope, "all");
  assert.equal(plan.stages.packages.scope, "none");
  assert.deepEqual(plan.commands.at(-1).args, ["exec", "oxfmt"]);
  assert.equal(plan.commands[0].args.at(-1), join(f.root, "eslint.config.js"));
  assert.equal(hasCommand(plan, "fix:native"), false);
});

test("package config lint autofix expands final formatting to consumers, not unrelated files", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.pkg("consumer", ["protocol"]);
  f.pkg("unrelated");
  const path = "packages/protocol/tsconfig.json";
  const plan = f.select("fix", [path]);
  assert.equal(plan.stages.lint.scope, "packages");
  assert.deepEqual(plan.stages.lint.targets, [
    "packages/consumer/src/index.ts",
    "packages/protocol/src/index.ts",
  ]);
  assert.equal(plan.stages.format.scope, "packages");
  assert.deepEqual(plan.stages.format.targets, [
    "packages/consumer/src/index.ts",
    "packages/protocol/src/index.ts",
    path,
  ]);
  assert.ok(
    plan.commands
      .at(-1)
      .args.includes(join(f.root, "packages/consumer/src/index.ts")),
  );
  assert.equal(plan.stages.packages.scope, "none");
});

test("lockfile broadens npm checks but never enables unrelated Rust", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.pkg("native");
  for (const operation of ["fix", "check"]) {
    const plan = f.select(operation, ["pnpm-lock.yaml"]);
    assert.equal(plan.stages.format.scope, "all");
    assert.equal(plan.stages.lint.scope, "all");
    assert.equal(
      plan.stages.packages.scope,
      operation === "check" ? "all" : "none",
    );
    assert.equal(plan.stages.native.scope, "none");
    assert.equal(hasCommand(plan, "check:native"), false);
    assert.ok(plan.commands.every((command) => command.stage !== "fallback"));
  }
});

test("unsupported required checks/preparation fail clearly before execution", (t) => {
  const f = fixture(t);
  f.pkg("missing", [], { scripts: {} });
  assert.throws(
    () => f.select("check", ["packages/missing/src/index.ts"]),
    /Unsupported emitted API preparation|No package check/,
  );
  f.pkg("custom", [], { scripts: { check: "custom-check" } });
  assert.throws(
    () => f.select("check", ["packages/custom/src/index.ts"]),
    /Unsupported emitted API preparation/,
  );
  f.pkg("invalid-config");
  f.write(
    "packages/invalid-config/tsconfig.json",
    JSON.stringify({
      compilerOptions: { composite: true, target: "not-a-target" },
      include: ["src/**/*.ts"],
    }),
  );
  assert.throws(
    () => f.select("check", ["packages/invalid-config/src/index.ts"]),
    /Unsupported declaration preparation/,
  );
  f.pkg("broken");
  f.write(
    "packages/broken/tsconfig.json",
    JSON.stringify({ compilerOptions: { noEmit: true } }),
  );
  assert.throws(
    () => f.select("check", ["packages/broken/src/index.ts"]),
    /Unsupported declaration preparation/,
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

test("invalid workspace graph cannot cause repository-wide autofix", (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.pkg("duplicate", [], { name: "@nervekit/protocol" });
  const path = "packages/protocol/src/index.ts";
  const fix = f.select("fix", [path]);
  assert.equal(fix.stages.format.scope, "changed");
  assert.equal(fix.stages.lint.scope, "changed");
  assert.equal(fix.stages.packages.scope, "none");
  assert.throws(() => f.select("check", [path]), /workspace name/);
});

test("missing workspace dependencies fail package validation without expanding file stages", (t) => {
  const f = fixture(t);
  f.pkg("protocol", ["missing"]);
  assert.throws(
    () => f.select("check", ["packages/protocol/src/index.ts"]),
    /Unknown workspace dependency/,
  );
  const plan = f.select("fix", ["packages/protocol/src/index.ts"]);
  assert.equal(plan.stages.format.scope, "changed");
  assert.equal(plan.stages.lint.scope, "changed");
});

test("manifest metadata is compared to Git baseline without package-wide validation", async (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  const manifest = {
    name: "fixture",
    version: "1",
    scripts: { dev: "node dev.mjs" },
  };
  f.write("package.json", JSON.stringify(manifest));
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
  f.write("package.json", JSON.stringify({ ...manifest, version: "2" }));
  git("add", "package.json");
  f.write(
    "package.json",
    JSON.stringify({
      ...manifest,
      version: "3",
      scripts: { dev: "node other.mjs" },
    }),
  );
  const plan = await planFocusedValidation(f.root, "check", "HEAD");
  assert.equal(plan.stages.format.scope, "changed");
  assert.deepEqual(plan.stages.format.targets, ["package.json"]);
  assert.equal(plan.stages.lint.scope, "none");
  assert.equal(plan.stages.packages.scope, "none");
  assert.equal(plan.stages.native.scope, "none");
  assert.equal(hasCommand(plan, "tsc"), false);
  f.write("package.json", "invalid JSON");
  await assert.rejects(
    planFocusedValidation(f.root, "fix", "HEAD"),
    /Cannot read current root package.json/,
  );
  f.write("package.json", JSON.stringify({ ...manifest, scripts: [] }));
  await assert.rejects(
    planFocusedValidation(f.root, "fix", "HEAD"),
    /expected string values/,
  );
});

test("unavailable baseline manifest broadens packages but preserves file scope", async (t) => {
  const f = fixture(t);
  f.pkg("protocol");
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
  f.write("package.json", JSON.stringify({ name: "fixture" }));
  const plan = await planFocusedValidation(f.root, "check", "HEAD");
  assert.equal(plan.stages.packages.scope, "all");
  assert.equal(plan.stages.format.scope, "changed");
  assert.equal(plan.stages.lint.scope, "none");
  assert.ok(
    plan.stages.packages.reasons.some((reason) =>
      /baseline|compar/i.test(reason),
    ),
  );
});

test("invalid baseline and missing current manifests broaden only package scope", async (t) => {
  const f = fixture(t);
  f.pkg("protocol");
  f.write("package.json", "invalid baseline JSON");
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
  f.write("package.json", JSON.stringify({ name: "fixture" }));
  const fixed = await planFocusedValidation(f.root, "check", "HEAD");
  assert.equal(fixed.stages.packages.scope, "all");
  assert.equal(fixed.stages.format.scope, "changed");
  assert.equal(fixed.stages.lint.scope, "none");
  rmSync(join(f.root, "package.json"));
  const removed = await planFocusedValidation(f.root, "check", "HEAD");
  assert.equal(removed.stages.packages.scope, "all");
  assert.equal(removed.stages.format.scope, "none");
  assert.equal(removed.stages.lint.scope, "none");
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
  assert.deepEqual(plan.stages.lint.targets, [
    "packages/protocol/src/index.ts",
  ]);
  assert.equal(plan.stages.format.targets.length, 2);
  f.write("eslint.config.mjs", 'throw new Error("bad lint config");');
  await assert.rejects(
    planFocusedValidation(f.root, "fix", "HEAD"),
    /bad lint config/,
  );
});

test("Git discovery failure produces an explicit full fallback", async (t) => {
  const f = fixture(t);
  const plan = await planFocusedValidation(f.root, "check", "does-not-exist");
  assert.equal(plan.mode, "full-fallback");
  assert.match(plan.reason, /Cannot discover changed files/);
  assert.deepEqual(plan.commands[0].args, ["run", "check"]);
});
