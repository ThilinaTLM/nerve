import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { compileModule } from "svelte/compiler";

let nextHarness = 0;

interface Harness {
  pending(): void;
  invalidate(): void;
  complete(): void;
  completePrs(): void;
  projectStale(): void;
  focus(): void;
  visibility(visible: boolean): void;
  selectRepo(repo: string): void;
  selectProject(id: string): void;
  enable(value: boolean): void;
  snapshot(): {
    discoveries: { projectId: string; uncertain: boolean; force: boolean }[];
    discoveryStale: { proj_a: boolean; proj_b: boolean };
    scans: string[];
    monitors: { scope: string; visible: boolean }[];
  };
  stop(): void;
}

/** Run the actual production effect, not a copied pure counter approximation.
 * Its external commands are instrumented, but all dependency tracking/cleanup is
 * performed by the installed Svelte client runtime and compiler.
 */
async function visibilityHarness(): Promise<{
  harness: Harness;
  flush(): void;
}> {
  const filename = new URL(
    "./workbench-git-panel-adapter.svelte.ts",
    import.meta.url,
  );
  const source = ts.createSourceFile(
    filename.pathname,
    await readFile(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let effect: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "$effect" &&
      node.arguments[0]
        ?.getText(source)
        .includes("setGitOverviewRefreshVisible")
    )
      effect = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(effect, "production visibility effect must be exercised");
  const moduleSource = `
import { untrack } from 'svelte';
const workbenchStartupState = $state({ progressiveActive: true });
let projectId = $state('proj_a');
let panelEnabled = $state(true);
const state = $state({ overviewInvalidated: true, loadedAt: 1, loadingOverview: false, prsLoadedAt: 1, github: { authenticated: true }, overviewRequest: { inFlight: false, refreshQueued: false, sequence: 0, invalidation: 0, uncertainInvalidation: true } });
const gitPanelState = $state({ projects: {
  proj_a: { selectedRepo: '.', repos: [{}], readsStale: false },
  proj_b: { selectedRepo: '.', repos: [{}], readsStale: false }
} });
const projects = { proj_a: { id: 'proj_a' }, proj_b: { id: 'proj_b' } };
const scans = [], monitors = [], discoveries = [];
const window = new EventTarget();
const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
const activeProject = () => projects[projectId];
const enabled = () => panelEnabled;
const pullRequestsEnabled = () => true;
const gitProjectStateKey = id => id;
function setGitOverviewRefreshVisible(id, repo, visible) { monitors.push({ scope: id + '/' + repo, visible }); }
async function requestGitRepositoryRefresh(id, repo) { scans.push(id + '/' + repo); }
async function refreshGitProject(project, options) { discoveries.push({ projectId: project.id, uncertain: Boolean(options.uncertain), force: Boolean(options.force) }); }
function autoRefreshGitOverview() { void state.overviewInvalidated; void state.loadedAt; void state.loadingOverview; void state.overviewRequest.inFlight; void state.overviewRequest.refreshQueued; void state.overviewRequest.sequence; void state.overviewRequest.invalidation; void state.overviewRequest.uncertainInvalidation; }
function autoRefreshPrsIfStale() { void state.github.authenticated; void state.prsLoadedAt; }
export const stop = $effect.root(() => { ${effect}; });
export function pending() { state.loadingOverview = true; state.overviewRequest.inFlight = true; state.overviewRequest.refreshQueued = true; state.overviewRequest.sequence++; }
export function invalidate() { state.overviewInvalidated = true; state.overviewRequest.invalidation++; state.overviewRequest.uncertainInvalidation = false; }
export function complete() { state.loadedAt++; state.overviewInvalidated = false; state.loadingOverview = false; state.overviewRequest.inFlight = false; state.overviewRequest.refreshQueued = false; }
export function completePrs() { state.prsLoadedAt++; state.github.authenticated = !state.github.authenticated; }
export function projectStale() { gitPanelState.projects[projectId].readsStale = true; }
export function focus() { window.dispatchEvent(new Event('focus')); }
export function visibility(visible) { document.visibilityState = visible ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }
export function selectRepo(repo) { gitPanelState.projects[projectId].selectedRepo = repo; }
export function selectProject(id) { projectId = id; }
export function enable(value) { panelEnabled = value; }
export function snapshot() { return { scans: [...scans], monitors: [...monitors], discoveries: [...discoveries], discoveryStale: { proj_a: gitPanelState.projects.proj_a.readsStale, proj_b: gitPanelState.projects.proj_b.readsStale } }; }
`;
  const runtimeUrl = import.meta.resolve("svelte/internal/client");
  const compiled = compileModule(moduleSource, {
    filename: "git-visibility-regression.svelte.js",
    generate: "client",
  }).js.code;
  const publicClientUrl = import.meta
    .resolve("svelte")
    .replace(/index-server\.js$/, "index-client.js");
  const code = compiled
    .replace(/(['"])svelte\/internal\/client\1/g, JSON.stringify(runtimeUrl))
    .replace(/(['"])svelte\1/g, JSON.stringify(publicClientUrl));
  const harness = (await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${++nextHarness}`
  )) as Harness;
  const runtime = (await import(publicClientUrl)) as { flushSync(): void };
  return { harness, flush: () => runtime.flushSync() };
}

void test("actual Svelte visibility effect ignores read completion but preserves focus, visibility, project/repository and enablement refresh", async () => {
  const { harness, flush } = await visibilityHarness();
  try {
    flush();
    assert.deepEqual(harness.snapshot().scans, ["proj_a/."]);
    for (let completion = 0; completion < 3; completion++) {
      harness.pending();
      flush();
      harness.invalidate();
      flush();
      harness.complete();
      flush();
      harness.completePrs();
      flush();
    }
    assert.deepEqual(
      harness.snapshot().scans,
      ["proj_a/."],
      "freshness/request updates cannot send another manual scan",
    );
    assert.equal(
      harness.snapshot().monitors.length,
      1,
      "read completion must not clear/re-register the monitor",
    );
    harness.focus();
    flush();
    assert.equal(harness.snapshot().scans.length, 2);
    assert.equal(harness.snapshot().monitors.length, 1);
    harness.visibility(false);
    flush();
    assert.equal(harness.snapshot().scans.length, 2);
    harness.visibility(true);
    flush();
    assert.equal(harness.snapshot().scans.length, 3);
    harness.selectRepo("nested");
    flush();
    assert.equal(harness.snapshot().scans.at(-1), "proj_a/nested");
    assert.deepEqual(harness.snapshot().monitors.slice(-2), [
      { scope: "proj_a/.", visible: false },
      { scope: "proj_a/nested", visible: true },
    ]);
    harness.selectProject("proj_b");
    flush();
    assert.equal(harness.snapshot().scans.at(-1), "proj_b/.");
    harness.enable(false);
    flush();
    const disabled = harness.snapshot().scans.length;
    harness.focus();
    harness.visibility(true);
    flush();
    assert.equal(harness.snapshot().scans.length, disabled);
    harness.enable(true);
    flush();
    assert.equal(harness.snapshot().scans.length, disabled + 1);
  } finally {
    harness.stop();
    flush();
  }
});

void test("actual visibility/focus demand revalidates stale discovery softly without subscribing to its stale flag", async () => {
  const { harness, flush } = await visibilityHarness();
  try {
    flush();
    harness.projectStale();
    flush();
    harness.complete();
    flush();
    assert.equal(
      harness.snapshot().discoveryStale.proj_a,
      true,
      "a fresh overview cannot clear project discovery staleness",
    );
    assert.equal(harness.snapshot().scans.length, 1);
    assert.deepEqual(harness.snapshot().discoveries, []);
    harness.focus();
    flush();
    assert.deepEqual(harness.snapshot().discoveries, [
      { projectId: "proj_a", uncertain: true, force: false },
    ]);
    harness.selectProject("proj_b");
    flush();
    assert.equal(
      harness.snapshot().discoveries.length,
      1,
      "another project's fresh discovery is not revalidated",
    );
    assert.equal(harness.snapshot().discoveryStale.proj_a, true);
  } finally {
    harness.stop();
    flush();
  }
});
