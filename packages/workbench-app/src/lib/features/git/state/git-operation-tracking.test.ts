import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import type { GitOperationStartRequest } from "@nervekit/contracts/git";
import type { ActivityStartedInput } from "$lib/application/activity/activity-state.svelte";
import {
  gitRemoteBusy,
  gitRunningOperations,
  observeGitOperationStart,
  observeBulkGitOperationStart,
} from "./git-operation-tracking.js";
void test("start acknowledgements map returned IDs and repository scope for remote actions, checkout and clone without leaking inputs", () => {
  const observed: ActivityStartedInput[] = [];
  const observer = {
    observeStarted: (input: ActivityStartedInput) => {
      observed.push(input);
    },
  };
  const scope = { projectId: "proj_started", repo: "nested/repo" };
  const inputs: GitOperationStartRequest[] = [
    ...(["fetch", "pull", "push", "sync", "switchBaseAndPull"] as const).map(
      (kind) => ({ ...scope, kind }),
    ),
    { ...scope, kind: "checkout", number: 42 },
    {
      ...scope,
      kind: "clone",
      remoteUrl: "https://private-token@example.invalid/repo",
    },
  ];
  const labels = [
    "Fetch",
    "Pull",
    "Push",
    "Sync",
    "Switch to base and pull",
    "Check out PR #42",
    "Clone",
  ];
  inputs.forEach((input, index) =>
    observeGitOperationStart(observer, input, `returned-${index}`),
  );
  assert.deepEqual(
    observed,
    inputs.map((input, index) => ({
      id: `returned-${index}`,
      kind: `git.${input.kind}`,
      title: `${labels[index]} · ${scope.repo}`,
      scope: { projectId: scope.projectId, repositoryPath: scope.repo },
    })),
  );
  assert.doesNotMatch(
    JSON.stringify(observed),
    /private-token|remoteUrl|example.invalid/,
  );
});

void test("bulk acknowledgements preserve returned parent/child IDs and server deduplicated repository order", () => {
  const observed: ActivityStartedInput[] = [];
  observeBulkGitOperationStart(
    {
      observeStarted: (input) => {
        observed.push(input);
      },
    },
    { projectId: "proj_bulk", kind: "pull", repos: ["b", "b", "a"] },
    {
      operationId: "parent-returned",
      childOperationIds: ["child-b", "failed-child-a"],
    },
  );
  assert.deepEqual(observed, [
    {
      id: "parent-returned",
      kind: "git.pull.all",
      title: "Pull all repositories",
      scope: { projectId: "proj_bulk" },
    },
    {
      id: "child-b",
      parentId: "parent-returned",
      kind: "git.pull",
      title: "Pull · b",
      scope: { projectId: "proj_bulk", repositoryPath: "b" },
    },
    {
      id: "failed-child-a",
      parentId: "parent-returned",
      kind: "git.pull",
      title: "Pull · a",
      scope: { projectId: "proj_bulk", repositoryPath: "a" },
    },
  ]);
});

function activity(
  id: string,
  kind: string,
  status: Activity["status"],
  projectId = "proj_a",
  repositoryPath?: string,
): Activity {
  return {
    id,
    kind,
    title: id,
    status,
    scope: { projectId, repositoryPath },
    revision: 1,
    startedAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
    actions: {
      cancel: status === "running" || status === "queued",
      retry: false,
    },
  };
}
void test("busy state follows queued/running IDs, not start-RPC completion or another project/repository", () => {
  const entries = [
    activity("fetch-a", "git.fetch", "queued", "proj_a", "a"),
    activity("pull-b", "git.pull", "running", "proj_a", "b"),
    activity("other", "git.push", "running", "proj_b", "a"),
    activity("finished", "git.sync", "succeeded", "proj_a", "a"),
  ];
  // The repository list needs every active row, not only the selected one.
  assert.deepEqual(
    gitRunningOperations(entries, "proj_a").map((entry) => entry.id),
    ["fetch-a", "pull-b"],
  );
  const busy = gitRemoteBusy(entries, "proj_a", "a");
  assert.deepEqual(busy.operationIds, ["fetch-a"]);
  assert.equal(busy.fetching, true);
  assert.equal(busy.pulling, false);
  assert.equal(busy.pushing, false);
  assert.equal(busy.syncing, false);
});
void test("terminal-before-ack, cancellation and restart-interruption clear remote busy", () => {
  for (const status of [
    "succeeded",
    "failed",
    "cancelled",
    "interrupted",
  ] as const) {
    const entries = [activity("id", "git.fetch", status, "proj_a", "a")];
    assert.deepEqual(gitRemoteBusy(entries, "proj_a", "a").operationIds, []);
    assert.deepEqual(gitRunningOperations(entries, "proj_a", "a"), []);
  }
});
void test("bulk parent remains visible without falsely marking unrelated repository work busy", () => {
  const parent = activity("parent", "git.pull.all", "running");
  const child = activity("child", "git.pull", "running", "proj_a", "a");
  assert.deepEqual(
    gitRunningOperations([parent, child], "proj_a", "b").map(
      (entry) => entry.id,
    ),
    ["parent"],
  );
  assert.equal(gitRemoteBusy([parent, child], "proj_a", "b").pulling, false);
  assert.equal(gitRemoteBusy([parent, child], "proj_a", "a").pulling, true);
});

void test("bulk base-pull acknowledgements project child scope and busy state without blocking other repositories", () => {
  const observed: ActivityStartedInput[] = [];
  observeBulkGitOperationStart(
    {
      observeStarted: (input) => {
        observed.push(input);
      },
    },
    { projectId: "proj_a", kind: "switchBaseAndPull", repos: ["a", "c"] },
    { operationId: "base-parent", childOperationIds: ["base-a", "base-c"] },
  );
  assert.deepEqual(
    observed.map(({ id, kind, parentId, scope }) => ({
      id,
      kind,
      parentId,
      scope,
    })),
    [
      {
        id: "base-parent",
        kind: "git.switchBaseAndPull.all",
        parentId: undefined,
        scope: { projectId: "proj_a" },
      },
      {
        id: "base-a",
        kind: "git.switchBaseAndPull",
        parentId: "base-parent",
        scope: { projectId: "proj_a", repositoryPath: "a" },
      },
      {
        id: "base-c",
        kind: "git.switchBaseAndPull",
        parentId: "base-parent",
        scope: { projectId: "proj_a", repositoryPath: "c" },
      },
    ],
  );
  const entries = observed.map((input) =>
    activity(
      input.id,
      input.kind,
      "queued",
      input.scope?.projectId,
      input.scope?.repositoryPath,
    ),
  );
  assert.equal(
    gitRemoteBusy(entries, "proj_a", "a").switchingBaseAndPulling,
    true,
  );
  assert.equal(
    gitRemoteBusy(entries, "proj_a", "b").switchingBaseAndPulling,
    false,
  );
});
