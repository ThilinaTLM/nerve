import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
    { os: "windows-latest", suite: "desktop" },
    { os: "macos-latest", suite: "desktop" },
  ]);
});

test("server changes select host and desktop platform suites", () => {
  const impact = classifyChanges(
    ["packages/workbench-server/src/main.ts"],
    workspace,
  );
  assert.deepEqual(impact.packages, [
    "@nervekit/desktop-shell",
    "@nervekit/workbench-server",
  ]);
  assert.equal(impact.workbench, true);
  assert.deepEqual(
    impact.nativeMatrix.map(
      ({ os, suite, shard }) => `${os}:${suite}${shard ? `:${shard}` : ""}`,
    ),
    [
      "windows-latest:host-native",
      "windows-latest:host-server",
      "windows-latest:host-tools",
      "windows-latest:host-migrations:1/2",
      "windows-latest:host-migrations:2/2",
      "windows-latest:desktop",
      "macos-latest:host-native",
      "macos-latest:host-server",
      "macos-latest:host-tools",
      "macos-latest:host-migrations:1/2",
      "macos-latest:host-migrations:2/2",
      "macos-latest:desktop",
    ],
  );
  assert.deepEqual(impact.nativeOsMatrix, [
    { os: "windows-latest" },
    { os: "macos-latest" },
  ]);
  // The native package itself is untouched, so Ubuntu validate does not run
  // cargo fmt/clippy and the dedicated job must.
  assert.equal(impact.rustLint, true);
});

test("contract changes expand through all reverse dependents", () => {
  const impact = classifyChanges(
    ["packages/contracts/src/index.ts"],
    workspace,
  );
  assert.deepEqual(impact.packages, [
    "@nervekit/contracts",
    "@nervekit/conversation-core",
    "@nervekit/desktop-shell",
    "@nervekit/harness",
    "@nervekit/protocol",
    "@nervekit/skills",
    "@nervekit/tools",
    "@nervekit/workbench-app",
    "@nervekit/workbench-server",
  ]);
  assert.equal(impact.workbench, true);
  assert.equal(impact.nativeMatrix.length, 12);
});

test("root dependency and unknown script changes fail safe to full coverage", () => {
  for (const path of [
    "pnpm-lock.yaml",
    "scripts/release/new-release-step.mjs",
    "scripts/new-root-script.ts",
    "scripts/build/new-build-step.mjs",
  ]) {
    const impact = classifyChanges([path], workspace);
    assert.equal(impact.full, true);
    assert.equal(impact.website, true);
    assert.equal(impact.nativeMatrix.length, 12);
    assert.ok(impact.packages.includes("@nervekit/ui-kit"));
    // Native package is selected, so Ubuntu validate already runs clippy.
    assert.equal(impact.rustLint, false);
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
    assert.deepEqual(impact.nativeOsMatrix, [], path);
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
    ["scripts/build/generate-brand-assets.mjs"],
    workspace,
  );
  assert.equal(brand.full, false);
  assert.deepEqual(brand.packages, ["@nervekit/desktop-shell"]);
  assert.equal(brand.website, false);

  const skills = classifyChanges(
    ["scripts/build/copy-skills-assets.mjs"],
    workspace,
  );
  assert.equal(skills.full, false);
  assert.deepEqual(skills.packages, [
    "@nervekit/conversation-core",
    "@nervekit/desktop-shell",
    "@nervekit/skills",
    "@nervekit/tools",
    "@nervekit/workbench-server",
  ]);

  const image = classifyChanges(
    ["scripts/release/smoke-electron-image-resize.ts"],
    workspace,
  );
  assert.equal(image.electronSmoke, true);
  assert.equal(image.nativeMatrixNeeded, true);
});

test("GitHub outputs are stable scalar and JSON values", () => {
  const outputs = githubOutputs(
    classifyChanges(["packages/workbench-app/src/app.ts"], workspace),
  );
  assert.equal(outputs.full, "false");
  assert.equal(outputs.has_packages, "true");
  assert.deepEqual(JSON.parse(outputs.packages), ["@nervekit/workbench-app"]);
  assert.deepEqual(JSON.parse(outputs.native_matrix), { include: [] });
  assert.deepEqual(JSON.parse(outputs.native_os_matrix), { include: [] });
  assert.equal(outputs.native_os_needed, "false");
  assert.equal(outputs.rust_lint, "false");
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
