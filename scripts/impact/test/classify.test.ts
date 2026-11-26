import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadWorkspace } from "../../workspace/graph.ts";
import { githubOutputs } from "../ci.ts";
import { classifyChanges } from "../classify.ts";

const workspace = loadWorkspace();

test("docs-only changes do not select package or platform work", () => {
  const impact = classifyChanges(
    ["docs/runbooks/release.md", "README.md"],
    workspace,
  );
  assert.deepEqual(impact.packages, []);
  assert.equal(impact.website, false);
  assert.equal(impact.nativeMatrixNeeded, false);
  assert.equal(impact.full, false);
});

test("docs assets of any type and root docs select nothing in CI", () => {
  for (const path of [
    "docs/ui/diagram.png",
    "docs/runbooks/data.json",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "LICENSE",
    "NOTICE",
  ]) {
    const impact = classifyChanges([path], workspace);
    assert.equal(impact.full, false, path);
    assert.deepEqual(impact.packages, [], path);
  }
});

test("website changes select only website validation", () => {
  const impact = classifyChanges(
    ["packages/website/src/pages/index.astro"],
    workspace,
  );
  assert.deepEqual(impact.packages, []);
  assert.equal(impact.website, true);
  assert.equal(impact.workbench, false);
  assert.equal(impact.native, false);
});

test("shared UI style changes select app and website without native matrix", () => {
  const impact = classifyChanges(
    ["packages/ui-kit/src/styles/theme.css"],
    workspace,
  );
  assert.deepEqual(impact.packages, [
    "@nervekit/extension-sdk",
    "@nervekit/ui-kit",
    "@nervekit/workbench-app",
  ]);
  assert.equal(impact.website, true);
  assert.equal(impact.workbench, true);
  assert.equal(impact.nativeMatrixNeeded, false);
});

test("desktop-only changes prepare runtime dependencies without website or Workbench smoke", () => {
  const impact = classifyChanges(
    ["packages/desktop-shell/src/main.ts"],
    workspace,
  );
  assert.deepEqual(impact.packages, ["@nervekit/desktop-shell"]);
  assert.ok(impact.dependencyPackages.includes("@nervekit/workbench-server"));
  assert.ok(impact.dependencyPackages.includes("@nervekit/native"));
  assert.equal(impact.website, false);
  assert.equal(impact.workbench, false);
  assert.deepEqual(impact.nativeMatrix, [
    { os: "windows-latest", name: "Windows", suites: ["desktop"] },
    { os: "macos-latest", name: "macOS", suites: ["desktop"] },
  ]);
});

const suitesFor = (path: string) => {
  const impact = classifyChanges([path], workspace);
  const [first, ...rest] = impact.nativeMatrix;
  // Every selected OS runs the same suites in one job.
  for (const entry of rest) assert.deepEqual(entry.suites, first.suites);
  return {
    jobs: impact.nativeMatrix.length,
    suites: first?.suites ?? [],
    packages: impact.packages,
  };
};

test("native suites are selected per suite, one job per OS", () => {
  const impact = classifyChanges(
    ["packages/workbench-server/src/domains/git/git.service.ts"],
    workspace,
  );
  assert.deepEqual(impact.packages, [
    "@nervekit/desktop-shell",
    "@nervekit/workbench-server",
  ]);
  assert.equal(impact.workbench, true);
  assert.deepEqual(
    impact.nativeMatrix.map(({ os, name }) => `${os}:${name}`),
    ["windows-latest:Windows", "macos-latest:macOS"],
  );
  assert.deepEqual(impact.nativeMatrix[0].suites, ["server", "desktop"]);
});

test("a test-only change selects only its own package and suite", () => {
  const impact = suitesFor("packages/tools/test/execution/bash.test.ts");
  assert.deepEqual(impact.packages, ["@nervekit/tools"]);
  assert.deepEqual(impact.suites, ["tools"]);
  assert.equal(impact.jobs, 2);

  const contracts = suitesFor("packages/contracts/src/schemas/a.test.ts");
  assert.deepEqual(contracts.packages, ["@nervekit/contracts"]);
  assert.equal(contracts.jobs, 0);
});

test("source-level test helpers still propagate to dependents", () => {
  for (const path of [
    "packages/conversation-core/src/runtime/lifecycle-test-helpers.ts",
    "packages/workbench-server/src/infrastructure/migrations/framework/testing/corruption-suite.ts",
  ]) {
    assert.ok(suitesFor(path).packages.length > 0, path);
  }
  assert.ok(
    classifyChanges(
      ["packages/conversation-core/src/runtime/lifecycle-test-helpers.ts"],
      workspace,
    ).packages.includes("@nervekit/workbench-server"),
  );
});

test("tools source selects tools, its dependents' suites and no migrations", () => {
  const impact = suitesFor("packages/tools/src/index.ts");
  assert.deepEqual(impact.suites, ["tools", "server", "desktop"]);
});

test("migration suites run only for migration inputs", () => {
  const migration = suitesFor(
    "packages/workbench-server/src/infrastructure/migrations/framework/runner.ts",
  );
  assert.deepEqual(migration.suites, ["server", "migrations", "desktop"]);
  assert.ok(
    suitesFor(
      "packages/workbench-server/test/infrastructure/persistence/x.test.ts",
    ).suites.includes("migrations"),
  );
  assert.deepEqual(
    suitesFor("packages/workbench-server/src/domains/git/git.service.ts")
      .suites,
    ["server", "desktop"],
  );
});

test("contract source changes run every suite except native", () => {
  const impact = suitesFor("packages/contracts/src/index.ts");
  assert.deepEqual(impact.suites, ["tools", "server", "migrations", "desktop"]);
  assert.equal(impact.jobs, 2);
});

test("Rust inputs select the native package and suite", () => {
  const impact = suitesFor("packages/native/native/src/lib.rs");
  assert.ok(impact.suites.includes("native"));
  assert.ok(impact.suites.includes("migrations"));
  // cargo fmt/clippy run through the native package's `check` in the Packages
  // jobs, so a Rust input must always select the native package.
  for (const path of [
    "packages/native/native/src/lib.rs",
    "packages/native/native/Cargo.toml",
  ]) {
    assert.ok(suitesFor(path).packages.includes("@nervekit/native"), path);
  }
});

test("frontend-only and docs-only changes select no native jobs", () => {
  assert.equal(suitesFor("packages/workbench-app/src/lib/app.ts").jobs, 0);
  assert.equal(suitesFor("docs/runbooks/release.md").jobs, 0);
});

test("root dependency and unknown script changes fail safe to full coverage", () => {
  for (const path of [
    "pnpm-lock.yaml",
    "scripts/new-root-script.ts",
    "scripts/build/new-build-step.mjs",
  ]) {
    const impact = classifyChanges([path], workspace);
    assert.equal(impact.full, true);
    assert.equal(impact.website, true);
    assert.deepEqual(impact.nativeMatrix[0].suites, [
      "native",
      "tools",
      "server",
      "migrations",
      "desktop",
    ]);
    assert.equal(impact.nativeMatrix.length, 2);
    assert.ok(impact.packages.includes("@nervekit/ui-kit"));
  }
});

const isNarrow = (paths: string[], rootManifest?: object) => {
  const impact = classifyChanges(paths, workspace, { rootManifest });
  return !impact.full && impact.packages.length === 0;
};

test("only ci.yml is a global workflow; other .github files are tooling", () => {
  assert.equal(
    classifyChanges([".github/workflows/ci.yml"], workspace).full,
    true,
  );
  for (const path of [
    ".github/workflows/codeql.yml",
    ".github/workflows/release-cut.yml",
    ".github/workflows/website-deploy.yml",
    ".github/dependabot.yml",
    ".github/FUNDING.yml",
    "scripts/README.md",
    "scripts/benchmarks/x.ts",
    "scripts/bench/x.ts",
    "scripts/release/pack-npm.ts",
    "scripts/build/x.test.ts",
    "scripts/build/skill-reference-assets.test.ts",
    "scripts/build/extension-frame-css.test.ts",
  ])
    assert.equal(isNarrow([path]), true, path);
  assert.equal(classifyChanges(["scripts/build/x.ts"], workspace).full, true);
});

test("special-owned build inputs and runtime markdown select their package", () => {
  for (const path of [
    "scripts/build/skill-reference-assets.ts",
    "packages/workbench-server/src/builtin-skills/builtin/configure-nerve/SKILL.md",
  ]) {
    const impact = classifyChanges([path], workspace);
    assert.equal(impact.full, false, path);
    assert.ok(impact.packages.includes("@nervekit/workbench-server"), path);
  }
  const css = classifyChanges(["scripts/build/extension-frame.css"], workspace);
  assert.equal(css.full, false);
  assert.ok(css.packages.includes("@nervekit/ui-kit"));
  assert.ok(css.packages.includes("@nervekit/workbench-server"));
});

test("root package.json is full only for semantic changes", () => {
  const base = {
    name: "x",
    version: "1.0.0",
    scripts: { lint: "a", build: "b" },
  };
  const delta = (after: object) => ({ before: base, after });
  assert.equal(
    isNarrow(["package.json"], delta({ ...base, version: "1.1.0" })),
    true,
  );
  assert.equal(
    isNarrow(
      ["package.json"],
      delta({ ...base, scripts: { ...base.scripts, lint: "c" } }),
    ),
    true,
  );
  assert.equal(
    isNarrow(
      ["package.json"],
      delta({ ...base, scripts: { ...base.scripts, build: "c" } }),
    ),
    false,
  );
  assert.equal(
    isNarrow(["package.json"], delta({ ...base, dependencies: { a: "1" } })),
    false,
  );
  assert.equal(isNarrow(["package.json"]), false);
});

test("an all-zero or unreachable base falls back to full coverage", () => {
  for (const base of ["0".repeat(40), "deadbeef".repeat(5)]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../ci.ts", import.meta.url)),
        "--base",
        base,
        "--head",
        "HEAD",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /using full coverage/);
    assert.equal(JSON.parse(result.stdout).full, true);
  }
});

test("developer tooling scripts and tests stay narrow", () => {
  for (const path of [
    "scripts/checks/style-policy.ts",
    "scripts/impact/ci.ts",
    "scripts/development/dev-workbench.ts",
    "scripts/cli/run.ts",
    "scripts/workspace/graph.ts",
    "scripts/impact/rules.ts",
    "scripts/storage-migrations/rehearse.ts",
    "scripts/release/test/release-version.test.ts",
    ".oxfmtrc.json",
  ]) {
    const impact = classifyChanges([path], workspace);
    assert.equal(impact.full, false, path);
    assert.deepEqual(impact.packages, [], path);
    assert.equal(impact.website, false, path);
    assert.equal(impact.nativeMatrixNeeded, false, path);
    assert.deepEqual(impact.nativeMatrix, [], path);
  }
  // Specifically owned scripts keep their owner even inside tooling dirs' siblings.
  assert.equal(
    classifyChanges(["scripts/release/smoke-workbench-release.ts"], workspace)
      .workbench,
    true,
  );
});

test("known operational scripts map to their owning runtime", () => {
  for (const path of [
    "scripts/build/copy-workbench-app-dist-to-workbench-server.ts",
    "scripts/release/smoke-workbench-release.ts",
  ]) {
    const workbench = classifyChanges([path], workspace);
    assert.equal(workbench.full, false);
    assert.equal(workbench.workbench, true);
  }

  const brand = classifyChanges(
    ["scripts/build/generate-brand-assets.ts"],
    workspace,
  );
  assert.equal(brand.full, false);
  assert.deepEqual(brand.packages, ["@nervekit/desktop-shell"]);
  assert.equal(brand.website, false);

  const skills = classifyChanges(
    ["scripts/build/copy-skills-assets.ts"],
    workspace,
  );
  assert.equal(skills.full, false);
  assert.deepEqual(skills.packages, [
    "@nervekit/desktop-shell",
    "@nervekit/workbench-server",
  ]);
});

test("GitHub outputs are stable scalar and JSON values", () => {
  const outputs = githubOutputs(
    classifyChanges(["packages/workbench-app/src/app.ts"], workspace),
  );
  assert.equal(outputs.full, "false");
  assert.equal(outputs.has_packages, "true");
  assert.deepEqual(JSON.parse(outputs.packages), ["@nervekit/workbench-app"]);
  assert.deepEqual(JSON.parse(outputs.native_windows_suites), []);
  assert.deepEqual(JSON.parse(outputs.native_macos_suites), []);
});

test("the CI entry point runs under plain Node without installed dependencies", () => {
  // The paths job executes this before `pnpm install`: it must stay erasable TypeScript.
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../ci.ts", import.meta.url)), "--full"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).full, true);
});

test("CI job names are literal so skipped checks render readably", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const names = [...workflow.matchAll(/^ {4}name: (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.ok(names.includes("CI / Gate"));
  for (const name of names) assert.doesNotMatch(name, /\$\{\{/, name);
  assert.doesNotMatch(workflow, /^\s+matrix:/m);
});
