import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitService } from "../../src/git/git-service.js";

type FileStatus = Awaited<
  ReturnType<GitService["projectFileStatus"]>
>["files"][number];

function file(
  path: string,
  index: FileStatus["index"],
  worktree: FileStatus["worktree"],
  untracked = false,
) {
  return { path, index, worktree, staged: false, untracked };
}

function statusBackend(
  files: (repoDir: string) => Promise<ReturnType<typeof file>[]>,
) {
  return {
    snapshot: async (repoDir: string) => ({
      headOid: "abcdef",
      branch: {
        head: "main",
        detached: false,
        upstream: null,
        ahead: null,
        behind: null,
      },
      refs: [],
      remotes: [],
      files: await files(repoDir),
      recentCommits: [],
      stashes: [],
    }),
    isAncestor: async () => false,
    resolveRevision: async (_repoDir: string, revision: string) => revision,
    validateBranchName: async () => true,
  };
}

describe("GitService project file status", () => {
  it("returns project-relative paths for a root repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-git-status-"));
    try {
      const service = new GitService(() => ({ dir: root, name: "repo" }), {
        readBackend: statusBackend(async (repoDir) => {
          assert.equal(repoDir, root);
          return [
            file("new.ts", "?", "?", true),
            file("modified.ts", " ", "M"),
            file("generated/", "!", "!"),
          ];
        }),
      });
      service.isRepo = async () => true;

      const result = await service.projectFileStatus("proj_test");
      assert.deepEqual(
        result.files.map((file) => [file.repo, file.path]),
        [
          [".", "generated"],
          [".", "modified.ts"],
          [".", "new.ts"],
        ],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefixes paths from nested repositories", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-git-status-"));
    try {
      await mkdir(join(root, "packages", "app", ".git"), { recursive: true });
      const service = new GitService(() => ({ dir: root, name: "project" }), {
        readBackend: statusBackend(async (repoDir) => {
          assert.equal(repoDir, join(root, "packages", "app"));
          return [file("src/index.ts", "?", "?", true)];
        }),
      });
      service.isRepo = async () => false;

      const result = await service.projectFileStatus("proj_test");
      assert.equal(result.files[0]?.repo, "packages/app");
      assert.equal(result.files[0]?.path, "packages/app/src/index.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
