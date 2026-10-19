import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitRepoSummary } from "@nervekit/contracts/git";
import type { Activity } from "@nervekit/contracts/activity";
import {
  activeRemoteOperation,
  lastRemoteFailure,
  repositoryRemoteBusy,
  runningRemoteActivity,
  syncSummary,
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

test("sync summary lists only the diverged directions", () => {
  assert.deepEqual(syncSummary(repo({ behind: 1, ahead: 2 })), {
    parts: ["↓1", "↑2"],
    help: "Sync: pull 1 commit, push 2 commits",
  });
  assert.deepEqual(syncSummary(repo({ behind: 0, ahead: 3 })).parts, ["↑3"]);
  assert.deepEqual(syncSummary(repo({ behind: 0, ahead: 0 })), {
    parts: [],
    help: "Up to date · Sync fetches remote changes",
  });
});

test("queued and running work is found only on its own repository", () => {
  const pull = activity("pull", "git.pull", "running");
  const activities = [
    activity("base", "git.switchBaseAndPull", "queued"),
    pull,
    activity("parent", "git.sync.all", "running"),
  ];
  assert.equal(runningRemoteActivity([pull], "."), pull);
  assert.equal(runningRemoteActivity(activities, "other"), undefined);
  assert.equal(repositoryRemoteBusy(activities, "."), true);
  assert.equal(repositoryRemoteBusy(activities, "other"), false);
  assert.equal(
    repositoryRemoteBusy([activity("done", "git.fetch", "succeeded")], "."),
    false,
  );
});

test("a failure shows only while it is the repository's latest remote operation", () => {
  const at = (
    id: string,
    status: Activity["status"],
    time: string,
    path = ".",
  ) => ({
    ...activity(id, "git.pull", status, path),
    finishedAt: time,
    updatedAt: time,
  });
  const failed = at("failed", "failed", "2026-10-18T10:00:00Z");
  assert.equal(lastRemoteFailure([failed], "."), failed);
  assert.equal(lastRemoteFailure([failed], "other"), undefined);
  assert.equal(
    lastRemoteFailure(
      [failed, at("ok", "succeeded", "2026-10-18T11:00:00Z")],
      ".",
    ),
    undefined,
  );
  assert.equal(
    lastRemoteFailure(
      [at("ok", "succeeded", "2026-10-18T09:00:00Z"), failed],
      ".",
    ),
    failed,
  );
  assert.equal(
    lastRemoteFailure([failed, activity("retry", "git.pull", "running")], "."),
    undefined,
  );
});
