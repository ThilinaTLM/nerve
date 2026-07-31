import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitStartupPolicy,
  shouldActivateGitPanel,
} from "./git-startup-policy";

test("refreshes the latest project once when progressive activation opens", () => {
  const refreshed: Array<string | undefined> = [];
  const policy = createGitStartupPolicy((projectId) =>
    refreshed.push(projectId),
  );
  policy.update(false, "old");
  policy.update(false, "latest");
  assert.deepEqual(refreshed, []);
  policy.update(true, "latest");
  policy.update(true, "latest");
  assert.deepEqual(refreshed, ["latest"]);
  policy.update(true, "next");
  assert.deepEqual(refreshed, ["latest", "next"]);
});

test("a hidden panel cannot activate Git detail loading", () => {
  assert.equal(
    shouldActivateGitPanel({
      progressiveActive: true,
      enabled: false,
      projectId: "project",
      lastProjectId: undefined,
    }),
    false,
  );
  assert.equal(
    shouldActivateGitPanel({
      progressiveActive: true,
      enabled: true,
      projectId: "project",
      lastProjectId: undefined,
    }),
    true,
  );
});
