import assert from "node:assert/strict";
import test from "node:test";
import { classifyChanges, githubOutputs, loadWorkspace } from "./ci-impact.mjs";

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
  assert.deepEqual(impact.nativeMatrix, [
    { os: "windows-latest", suite: "host" },
    { os: "windows-latest", suite: "desktop" },
    { os: "macos-latest", suite: "host" },
    { os: "macos-latest", suite: "desktop" },
  ]);
});

test("contract changes expand through all reverse dependents", () => {
  const impact = classifyChanges(
    ["packages/contracts/src/index.ts"],
    workspace,
  );
  assert.deepEqual(impact.packages, [
    "@nervekit/contracts",
    "@nervekit/desktop-shell",
    "@nervekit/harness",
    "@nervekit/protocol",
    "@nervekit/skills",
    "@nervekit/tools",
    "@nervekit/workbench-app",
    "@nervekit/workbench-server",
  ]);
  assert.equal(impact.workbench, true);
  assert.equal(impact.nativeMatrix.length, 4);
});

test("root dependency and unknown script changes fail safe to full coverage", () => {
  for (const path of ["pnpm-lock.yaml", "scripts/new-release-step.mjs"]) {
    const impact = classifyChanges([path], workspace);
    assert.equal(impact.full, true);
    assert.equal(impact.website, true);
    assert.equal(impact.nativeMatrix.length, 4);
    assert.ok(impact.packages.includes("@nervekit/ui-kit"));
  }
});

test("known operational scripts map to their owning runtime", () => {
  const workbench = classifyChanges(
    ["scripts/copy-workbench-app-dist-to-workbench-server.mjs"],
    workspace,
  );
  assert.equal(workbench.full, false);
  assert.equal(workbench.workbench, true);

  const skills = classifyChanges(["scripts/copy-skills-assets.mjs"], workspace);
  assert.equal(skills.full, false);
  assert.deepEqual(skills.packages, [
    "@nervekit/desktop-shell",
    "@nervekit/skills",
    "@nervekit/workbench-server",
  ]);

  const image = classifyChanges(
    ["scripts/smoke-electron-image-resize.mjs"],
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
});
