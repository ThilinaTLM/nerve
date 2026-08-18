import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitService } from "../src/git/git-service.js";

async function withRepo(
  fn: (repoDir: string, service: GitService) => Promise<void>,
): Promise<void> {
  const repoDir = await mkdtemp(join(tmpdir(), "nerve-git-diff-"));
  const service = new GitService(() => ({ dir: repoDir, name: "repo" }));
  try {
    await service.runGit(repoDir, ["init", "--initial-branch=main"]);
    await service.runGit(repoDir, ["config", "user.name", "Nerve Test"]);
    await service.runGit(repoDir, [
      "config",
      "user.email",
      "nerve@example.com",
    ]);
    await writeFile(join(repoDir, "file.ts"), "original\n");
    await service.runGit(repoDir, ["add", "file.ts"]);
    await service.runGit(repoDir, ["commit", "-m", "initial"]);
    await fn(repoDir, service);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

describe("GitService fileDiff", () => {
  it("reads complete HEAD and index documents for a staged file", async () => {
    await withRepo(async (repoDir, service) => {
      await writeFile(join(repoDir, "file.ts"), "staged\n");
      await service.runGit(repoDir, ["add", "file.ts"]);

      assert.deepEqual(
        await service.fileDiff("project", ".", "file.ts", "staged"),
        {
          path: "file.ts",
          area: "staged",
          binary: false,
          original: "original\n",
          modified: "staged\n",
        },
      );
    });
  });

  it("reads index and working-tree documents for an unstaged file", async () => {
    await withRepo(async (repoDir, service) => {
      await writeFile(join(repoDir, "file.ts"), "working tree\n");

      assert.deepEqual(
        await service.fileDiff("project", ".", "file.ts", "unstaged"),
        {
          path: "file.ts",
          area: "unstaged",
          binary: false,
          original: "original\n",
          modified: "working tree\n",
        },
      );
    });
  });

  it("uses empty documents for additions and deletions", async () => {
    await withRepo(async (repoDir, service) => {
      await writeFile(join(repoDir, "added.ts"), "added\n");
      await service.runGit(repoDir, ["add", "added.ts"]);
      const addition = await service.fileDiff(
        "project",
        ".",
        "added.ts",
        "staged",
      );
      assert.equal(addition.binary, false);
      if (!addition.binary) {
        assert.equal(addition.original, "");
        assert.equal(addition.modified, "added\n");
      }

      await service.runGit(repoDir, ["rm", "file.ts"]);
      const deletion = await service.fileDiff(
        "project",
        ".",
        "file.ts",
        "staged",
      );
      assert.equal(deletion.binary, false);
      if (!deletion.binary) {
        assert.equal(deletion.original, "original\n");
        assert.equal(deletion.modified, "");
      }
    });
  });

  it("classifies binary and rejects out-of-scope paths", async () => {
    await withRepo(async (repoDir, service) => {
      await writeFile(join(repoDir, "binary.dat"), Buffer.from([0, 1, 2]));
      await service.runGit(repoDir, ["add", "binary.dat"]);
      const binary = await service.fileDiff(
        "project",
        ".",
        "binary.dat",
        "staged",
      );
      assert.equal(binary.binary, true);

      await assert.rejects(
        service.fileDiff("project", ".", "../outside.ts", "unstaged"),
        /repository-relative|outside the repository/,
      );
    });
  });
});
