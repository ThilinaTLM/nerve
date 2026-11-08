import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { GitService } from "../../src/git/git-service.js";

const execFileAsync = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
  (await execFileAsync("git", args, { cwd })).stdout.trim();

describe("Git worktree discovery summaries", () => {
  it("groups linked worktrees, names them after the primary and counts stashes", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "nerve-wt-")));
    const project = join(base, "project");
    const outside = join(base, "outside-wt");
    try {
      const main = join(project, "api");
      await mkdir(main, { recursive: true });
      await git(main, "init", "-b", "main");
      await git(main, "config", "user.email", "nerve@example.test");
      await git(main, "config", "user.name", "Nerve Tests");
      await writeFile(join(main, "a.txt"), "base\n");
      await git(main, "add", ".");
      await git(main, "commit", "-m", "initial");
      await git(
        main,
        "worktree",
        "add",
        "-b",
        "feat",
        join(main, ".worktrees", "feat"),
      );
      await git(main, "worktree", "add", "-b", "away", outside);
      await writeFile(join(main, "a.txt"), "dirty\n");
      await git(main, "stash");

      const result = await GitService.forWorkspace(
        project,
        "project",
      ).discoverRepos("proj_test");
      assert.deepEqual(
        result.repos.map((repo) => [
          repo.relativePath,
          repo.name,
          repo.primaryWorktree,
          repo.stashCount,
        ]),
        [
          ["api", "api", true, 1],
          ["api/.worktrees/feat", "api", false, 1],
        ],
      );
      assert.equal(
        new Set(result.repos.map((repo) => repo.worktreeGroup)).size,
        1,
      );
      assert.deepEqual(result.outsideWorktrees, [
        { worktreeGroup: result.repos[0]?.worktreeGroup, count: 1 },
      ]);
      assert.equal(basename(result.repos[1]?.absDir ?? ""), "feat");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
