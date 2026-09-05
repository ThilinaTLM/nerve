import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listBranches,
  type GitBranchServicePort,
} from "../../src/git/git-branches.js";
import type { GitReadSnapshot } from "../../src/git/read/types.js";

function snapshot(): GitReadSnapshot {
  return {
    headOid: "abc",
    branch: {
      head: "main",
      detached: false,
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
    },
    refs: [
      {
        name: "refs/heads/main",
        upstream: "origin/main",
        commitTimestampSeconds: 1_788_220_800,
      },
      { name: "refs/heads/unresolved" },
      {
        name: "refs/remotes/origin/feature",
        commitTimestampSeconds: 1_788_307_200,
      },
      { name: "refs/remotes/origin/HEAD", symbolicTarget: "origin/main" },
      { name: "refs/tags/v1" },
    ],
    remotes: [],
    files: [],
    recentCommits: [],
    stashes: [],
  };
}

test("lists local and remote branches with nullable tip activity", async () => {
  const service = {
    resolveRepoDir: () => "/repo",
    readSnapshot: async () => snapshot(),
  } as unknown as GitBranchServicePort;

  const result = await listBranches(service, "proj_test", ".");

  assert.deepEqual(result.branches, [
    {
      name: "main",
      current: true,
      remote: false,
      upstream: "origin/main",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      name: "unresolved",
      current: false,
      remote: false,
      upstream: null,
      updatedAt: null,
    },
    {
      name: "origin/feature",
      current: false,
      remote: true,
      upstream: null,
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
  ]);
});
