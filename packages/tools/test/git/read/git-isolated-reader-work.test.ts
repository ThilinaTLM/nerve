import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NativeGitProjectRepository,
  NativeGitSnapshot,
} from "@nervekit/native";
import {
  readGitIsolatedFrame,
  type GitIsolatedReadPort,
} from "../../../src/git/read/git-isolated-reader-work.js";
import {
  parseGitIsolatedFrame,
  serializeGitIsolatedFrame,
} from "../../../src/git/read/git-isolated-reader-protocol.js";

const repository = {
  relativePath: ".",
  workDir: "/synthetic",
  gitDir: "/synthetic/.git",
  commonDir: "/synthetic/.git",
};
function discovery(identity: NativeGitProjectRepository) {
  return {
    root: identity.workDir,
    projectIsRepo: true,
    repositories: [identity],
  };
}
function detailed(identity: NativeGitProjectRepository): NativeGitSnapshot {
  return {
    gitDir: identity.gitDir,
    workDir: identity.workDir,
    headBranch: "main",
    detached: false,
    inProgress: ["merge"],
    files: [],
    refs: [],
    remotes: [],
    recentCommits: [],
    stashes: [],
  };
}
test("stale expected metadata is rejected before the native detailed reader/filter can execute", async () => {
  let filterExecutions = 0;
  const port: GitIsolatedReadPort = {
    async discover() {
      return discovery({
        ...repository,
        gitDir: "/changed/.git",
        commonDir: "/changed/.git",
      });
    },
    async snapshot() {
      filterExecutions++;
      return detailed(repository);
    },
    async canonicalPath(path) {
      return path;
    },
  };
  const result = await readGitIsolatedFrame(
    { expected: repository, includeIgnored: false },
    port,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, "invalid_input");
  assert.equal(filterExecutions, 0);
});
test("post-read identity change is still rejected without claiming transactional isolation", async () => {
  let discoveries = 0;
  const result = await readGitIsolatedFrame(
    { expected: repository, includeIgnored: false },
    {
      async discover() {
        return discovery(
          discoveries++ === 0
            ? repository
            : { ...repository, commonDir: "/changed/.git" },
        );
      },
      async snapshot() {
        return detailed(repository);
      },
      async canonicalPath(path) {
        return path;
      },
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, "invalid_input");
});
test("Windows drive and UNC canonical spellings use C's shared key on Linux too", async () => {
  const cases = [
    {
      expected: {
        relativePath: ".",
        workDir: "\\\\?\\C:\\Work\\Repo",
        gitDir: "\\\\?\\C:\\Work\\Repo\\.git",
        commonDir: "\\\\?\\C:\\Work\\Repo\\.git",
      },
      node: {
        relativePath: ".",
        workDir: "c:\\WORK\\repo\\",
        gitDir: "C:\\work\\REPO\\.git\\",
        commonDir: "C:\\work\\REPO\\.git\\",
      },
    },
    {
      expected: {
        relativePath: ".",
        workDir: "\\\\?\\UNC\\Server\\Share\\Repo",
        gitDir: "\\\\?\\UNC\\Server\\Share\\Repo\\.git",
        commonDir: "\\\\?\\UNC\\Server\\Share\\Repo\\.git",
      },
      node: {
        relativePath: ".",
        workDir: "\\\\server\\SHARE\\repo\\",
        gitDir: "\\\\SERVER\\share\\repo\\.git\\",
        commonDir: "\\\\SERVER\\share\\repo\\.git\\",
      },
    },
  ];
  for (const { expected, node } of cases) {
    const ioPaths: string[] = [];
    const result = await readGitIsolatedFrame(
      { expected, includeIgnored: false },
      {
        async discover(path) {
          ioPaths.push(path);
          return discovery(expected);
        },
        async snapshot(path) {
          ioPaths.push(path);
          return detailed(expected);
        },
        async canonicalPath(path) {
          return path === expected.workDir ? node.workDir : node.gitDir;
        },
      },
      "win32",
    );
    assert.equal(result.ok, true);
    assert.deepEqual(ioPaths, [
      expected.workDir,
      expected.workDir,
      expected.workDir,
    ]);
    if (result.ok) {
      const frame = serializeGitIsolatedFrame({ ...result, identity: node });
      assert.ok("files" in parseGitIsolatedFrame(frame, expected, "win32"));
    }
  }
});
