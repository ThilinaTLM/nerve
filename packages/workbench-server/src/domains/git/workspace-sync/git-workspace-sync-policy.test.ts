import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GIT_WORKSPACE_DEBOUNCE_MS,
  GIT_WORKSPACE_MAX_WAIT_MS,
  GIT_WORKSPACE_UNCERTAIN_POLL_MS,
  GitWorkspaceDemandRegistry,
  dueAt,
  markDirty,
  nextUncertainPoll,
  planReads,
  repoPriority,
  summarizeDemands,
  wantsDetail,
  type QueueCandidate,
} from "./git-workspace-sync-policy.js";

const candidate = (
  key: string,
  priority: QueueCandidate["priority"],
  at = 0,
  immediate = false,
): QueueCandidate => ({
  key,
  priority,
  dirty: markDirty(undefined, at, immediate),
  running: false,
});

void test("priorities: mutation > detail > selected > visible > hint", () => {
  const candidates = [
    candidate("hint", "hint"),
    candidate("visible", "visible"),
    candidate("selected", "selected"),
    candidate("detail", "detail"),
    candidate("mutation", "mutation"),
  ];
  const plan = planReads(candidates, 10_000, 0, 5);
  assert.deepEqual(plan.start, [
    "mutation",
    "detail",
    "selected",
    "visible",
    "hint",
  ]);
});

void test("concurrency limit leaves lower priorities queued", () => {
  const candidates = [
    candidate("a", "visible"),
    candidate("b", "detail"),
    candidate("c", "hint"),
  ];
  assert.deepEqual(planReads(candidates, 10_000, 0, 2).start, ["b", "a"]);
  assert.deepEqual(planReads(candidates, 10_000, 1, 2).start, ["b"]);
  assert.deepEqual(planReads(candidates, 10_000, 2, 2).start, []);
});

void test("debounce trails the last change but is capped by max wait", () => {
  let dirty = markDirty(undefined, 1_000, false);
  assert.equal(dueAt(dirty), 1_000 + GIT_WORKSPACE_DEBOUNCE_MS);
  dirty = markDirty(dirty, 1_200, false);
  assert.equal(dueAt(dirty), 1_200 + GIT_WORKSPACE_DEBOUNCE_MS);
  for (let at = 1_400; at < 6_000; at += 200)
    dirty = markDirty(dirty, at, false);
  assert.equal(dueAt(dirty), 1_000 + GIT_WORKSPACE_MAX_WAIT_MS);
});

void test("immediate marks bypass the debounce and stick", () => {
  const dirty = markDirty(markDirty(undefined, 5_000, false), 5_100, true);
  assert.equal(dueAt(dirty), 5_000);
  assert.equal(markDirty(dirty, 5_200, false).immediate, true);
  const plan = planReads([candidate("a", "visible", 5_000, true)], 5_000, 0);
  assert.deepEqual(plan.start, ["a"]);
});

void test("not-yet-due candidates wake at the earliest due time; running keys never double-start", () => {
  const waiting = candidate("w", "visible", 1_000);
  const plan = planReads([waiting], 1_100, 0);
  assert.deepEqual(plan.start, []);
  assert.equal(plan.wakeAt, 1_000 + GIT_WORKSPACE_DEBOUNCE_MS);
  const running = { ...candidate("r", "detail", 0, true), running: true };
  assert.deepEqual(planReads([running], 5_000, 0).start, []);
});

void test("demand: nothing demanded means nothing is read", () => {
  const none = summarizeDemands([]);
  assert.equal(repoPriority(none, "a", undefined, true), null);
  const visible = summarizeDemands([{ visible: true }]);
  assert.equal(repoPriority(visible, "a", undefined, false), "visible");
  assert.equal(repoPriority(visible, "a", "a", false), "selected");
  assert.equal(repoPriority(visible, "a", "a", true), "mutation");
  // Warm-only hint reads rank last even when the project is visible.
  const hinted = summarizeDemands([{ visible: true, hint: "b" }]);
  assert.equal(repoPriority(hinted, "b", undefined, false, true), "hint");
  assert.equal(repoPriority(hinted, "b", undefined, false, false), "visible");
  assert.equal(repoPriority(hinted, "b", undefined, true, true), "mutation");
  const detail = summarizeDemands([
    { visible: false, detail: ["a"], hint: "b" },
  ]);
  assert.equal(repoPriority(detail, "a", undefined, false), "detail");
  assert.equal(repoPriority(detail, "b", undefined, false), "hint");
  assert.equal(repoPriority(detail, "c", undefined, false), null);
  assert.equal(wantsDetail(detail, "b"), true);
  assert.equal(wantsDetail(visible, "a"), false);
});

void test("demand registry merges owners and releases with the owner", () => {
  const registry = new GitWorkspaceDemandRegistry();
  registry.sync("s1", "proj_a", { visible: true });
  registry.sync("s2", "proj_a", { visible: false, detail: ["x"] });
  assert.deepEqual(registry.ownersOf("proj_a").sort(), ["s1", "s2"]);
  const summary = summarizeDemands(registry.demands("proj_a"));
  assert.equal(summary.visible, true);
  assert.deepEqual([...summary.details], ["x"]);
  registry.clear("s1");
  assert.deepEqual(registry.ownersOf("proj_a"), ["s2"]);
  // Releasing all demand in a sync removes the entry.
  registry.sync("s2", "proj_a", { visible: false });
  assert.deepEqual(registry.ownersOf("proj_a"), []);
});

void test("uncertain scopes are polled slowly, never earlier than the interval", () => {
  assert.equal(
    nextUncertainPoll(1_000, 2_000),
    1_000 + GIT_WORKSPACE_UNCERTAIN_POLL_MS,
  );
  assert.equal(nextUncertainPoll(0, 100_000), 100_000);
});
