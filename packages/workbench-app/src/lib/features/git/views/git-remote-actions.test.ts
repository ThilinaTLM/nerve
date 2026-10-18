import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitRepoSummary } from "@nervekit/contracts/git";
import type { Activity } from "@nervekit/contracts/activity";
import {
  activeRemoteOperation,
  basePullDisabled,
  pullDisabled,
  remoteActionDisabled,
  visibleRemoteActions,
  repositoryRemoteBusy,
} from "./git-remote-actions.js";

function repo(overrides: Partial<GitRepoSummary> = {}): GitRepoSummary {
  return {
    relativePath: ".",
    absDir: "/repo",
    name: "repo",
    isRepo: true,
    currentBranch: "feature",
    detached: false,
    ahead: 0,
    behind: 1,
    hasUpstream: true,
    hasRemote: true,
    hasGithubRemote: false,
    baseBranch: "main",
    onBaseBranch: false,
    mergedToBase: false,
    dirty: false,
    changeCount: 0,
    ...overrides,
  };
}

test("allows pull and base switching with compatible local changes", () => {
  const dirtyRepo = repo({ dirty: true, changeCount: 1 });

  assert.equal(pullDisabled(dirtyRepo, false), false);
  assert.equal(basePullDisabled(dirtyRepo, false), false);
});

test("keeps actual remote-operation prerequisites disabled", () => {
  assert.equal(remoteActionDisabled(repo({ hasRemote: false }), false), true);
  assert.equal(pullDisabled(repo({ hasUpstream: false }), false), true);
  assert.equal(pullDisabled(repo({ detached: true }), false), true);
  assert.equal(pullDisabled(repo(), true), true);
  assert.equal(basePullDisabled(repo({ hasRemote: false }), false), true);
  assert.equal(basePullDisabled(repo(), true), true);
});

function activity(
  id: string,
  kind: string,
  status: Activity["status"],
  repositoryPath = ".",
  cancel = true,
): Activity {
  return {
    id,
    kind,
    status,
    title: id,
    revision: 1,
    startedAt: "2026-10-18T00:00:00Z",
    updatedAt: "2026-10-18T00:00:00Z",
    scope: { projectId: "proj_test", repositoryPath },
    actions: { cancel, retry: false },
  };
}

test("stop targets the running operation, not queued work, bulk parents, another repository or terminal history", () => {
  const queued = activity("queued", "git.sync", "queued");
  const running = activity("running", "git.sync", "running");
  const activities = [
    activity("parent", "git.sync.all", "running"),
    activity("other", "git.sync", "running", "other"),
    activity("finished", "git.sync", "failed"),
    queued,
    running,
  ];
  assert.equal(activeRemoteOperation(activities, ".", "sync"), running);
  assert.equal(activeRemoteOperation([queued], ".", "sync"), queued);
  assert.equal(activeRemoteOperation(activities, ".", "push"), undefined);
  assert.equal(
    activeRemoteOperation(
      [activity("done", "git.fetch", "cancelled")],
      ".",
      "fetch",
    ),
    undefined,
  );
});

test("a noncancellable running operation is retained instead of incorrectly stopping a queued sibling", () => {
  const running = activity("closing", "git.pull", "running", ".", false);
  assert.equal(
    activeRemoteOperation(
      [activity("queued", "git.pull", "queued"), running],
      ".",
      "pull",
    ),
    running,
  );
  const basePull = activity("base", "git.switchBaseAndPull", "running");
  assert.equal(
    activeRemoteOperation([basePull], ".", "switch-base-and-pull"),
    basePull,
  );
});

test("row visibility keeps Fetch and Sync anchored and only shows useful conditional actions", () => {
  assert.deepEqual(visibleRemoteActions(repo({ ahead: 2 }), []), [
    "switch-base-and-pull",
    "pull",
    "push",
    "fetch",
    "sync",
  ]);
  assert.deepEqual(
    visibleRemoteActions(repo({ onBaseBranch: true, behind: 0 }), []),
    ["fetch", "sync"],
  );
  assert.deepEqual(visibleRemoteActions(repo({ hasRemote: false }), []), [
    "fetch",
    "sync",
  ]);
});

test("queued and running controls survive changed metadata only on their own repository", () => {
  const metadata = repo({
    hasRemote: false,
    hasUpstream: false,
    detached: true,
    onBaseBranch: true,
    ahead: 0,
    behind: 0,
  });
  const activities = [
    activity("base", "git.switchBaseAndPull", "queued"),
    activity("pull", "git.pull", "running"),
    activity("push", "git.push", "queued"),
  ];
  assert.deepEqual(visibleRemoteActions(metadata, activities), [
    "switch-base-and-pull",
    "pull",
    "push",
    "fetch",
    "sync",
  ]);
  assert.deepEqual(
    visibleRemoteActions({ ...metadata, relativePath: "other" }, activities),
    ["fetch", "sync"],
  );
  assert.equal(repositoryRemoteBusy(activities, "."), true);
  assert.equal(repositoryRemoteBusy(activities, "other"), false);
  assert.equal(
    repositoryRemoteBusy([activity("done", "git.fetch", "succeeded")], "."),
    false,
  );
});
