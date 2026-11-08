import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GitWorkflowError } from "../../src/git/git-errors.js";
import { GitService } from "../../src/git/git-service.js";

interface Fixture {
  root: string;
  work: string;
  service: GitService;
  git(cwd: string, ...args: string[]): Promise<string>;
}

async function withFixture(run: (f: Fixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-worktree-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const service = new GitService(() => ({ dir: work, name: "work" }));
  const git = async (cwd: string, ...args: string[]) =>
    (await service.runGit(cwd, args)).stdout;
  try {
    await git(root, "init", "--bare", "--initial-branch=main", remote);
    await git(root, "init", "--initial-branch=main", work);
    await git(work, "config", "user.name", "Nerve Test");
    await git(work, "config", "user.email", "nerve@example.test");
    await writeFile(join(work, "a.txt"), "a\n");
    await git(work, "add", ".");
    await git(work, "commit", "-m", "initial");
    await git(work, "remote", "add", "origin", remote);
    await git(work, "push", "-u", "origin", "main");
    await run({ root, work, service, git });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function rejectsWith(code: string, status: number) {
  return (error: unknown) =>
    error instanceof GitWorkflowError &&
    error.code === code &&
    error.status === status;
}

describe("GitService worktree management", () => {
  it("creates a worktree on a new branch from the base and keeps the primary clean", async () => {
    await withFixture(async (f) => {
      await f.git(f.work, "switch", "-c", "other");
      const result = await f.service.createWorktree("p", ".", "feature/x");
      assert.equal(result.repo.relativePath, ".worktrees/feature-x");
      assert.equal(result.repo.currentBranch, "feature/x");
      assert.equal(result.repo.primaryWorktree, false);
      assert.ok(existsSync(join(f.work, ".worktrees", "feature-x", "a.txt")));
      assert.equal(
        (await f.git(f.work, "rev-parse", "feature/x")).trim(),
        (await f.git(f.work, "rev-parse", "origin/main")).trim(),
      );
      await f.service.createWorktree("p", ".", "feature/y", "custom");
      const exclude = await readFile(
        join(f.work, ".git", "info", "exclude"),
        "utf8",
      );
      assert.equal(exclude.split("/.worktrees/").length - 1, 1);
      assert.equal((await f.git(f.work, "status", "--porcelain")).trim(), "");
    });
  });

  it("checks out an existing local branch and tracks a remote-only branch", async () => {
    await withFixture(async (f) => {
      await f.git(f.work, "branch", "local-one");
      const local = await f.service.createWorktree("p", ".", "local-one");
      assert.equal(local.repo.currentBranch, "local-one");

      await f.git(f.work, "branch", "remote-one");
      await f.git(f.work, "push", "origin", "remote-one");
      await f.git(f.work, "branch", "-D", "remote-one");
      await f.git(f.work, "fetch", "origin");
      const remote = await f.service.createWorktree("p", ".", "remote-one");
      assert.equal(remote.repo.currentBranch, "remote-one");
      assert.equal(
        (
          await f.git(
            f.work,
            "rev-parse",
            "--abbrev-ref",
            "remote-one@{upstream}",
          )
        ).trim(),
        "origin/remote-one",
      );
    });
  });

  it("rejects checked-out branches, invalid ids and existing paths", async () => {
    await withFixture(async (f) => {
      await assert.rejects(
        f.service.createWorktree("p", ".", "main"),
        rejectsWith("GIT_BRANCH_CHECKED_OUT", 409),
      );
      await assert.rejects(
        f.service.createWorktree("p", ".", "ok", "../escape"),
        rejectsWith("GIT_INVALID_WORKTREE_ID", 400),
      );
      await assert.rejects(
        f.service.createWorktree("p", ".", "bad..name"),
        rejectsWith("GIT_INVALID_BRANCH_NAME", 400),
      );
      await mkdir(join(f.work, ".worktrees", "taken"), { recursive: true });
      await assert.rejects(
        f.service.createWorktree("p", ".", "ok", "taken"),
        rejectsWith("GIT_WORKTREE_EXISTS", 409),
      );
    });
  });

  it("removes clean worktrees and refuses dirty ones unless forced", async () => {
    await withFixture(async (f) => {
      const opts = { force: false, deleteBranch: false };
      await f.service.createWorktree("p", ".", "clean");
      const removed = await f.service.removeWorktree(
        "p",
        ".worktrees/clean",
        opts,
      );
      assert.equal(removed.repo.relativePath, ".");
      assert.equal(removed.repo.primaryWorktree, true);
      assert.equal(existsSync(join(f.work, ".worktrees", "clean")), false);
      assert.match(await f.git(f.work, "branch", "--list", "clean"), /clean/);

      await f.service.createWorktree("p", ".", "dirty");
      await writeFile(join(f.work, ".worktrees", "dirty", "a.txt"), "edit\n");
      await assert.rejects(
        f.service.removeWorktree("p", ".worktrees/dirty", opts),
        rejectsWith("GIT_WORKTREE_DIRTY", 409),
      );
      assert.ok(existsSync(join(f.work, ".worktrees", "dirty")));
      await f.service.removeWorktree("p", ".worktrees/dirty", {
        ...opts,
        force: true,
      });
      assert.equal(existsSync(join(f.work, ".worktrees", "dirty")), false);
    });
  });

  it("rejects the primary and deletes the branch only when asked", async () => {
    await withFixture(async (f) => {
      await assert.rejects(
        f.service.removeWorktree("p", ".", { force: true, deleteBranch: true }),
        rejectsWith("GIT_PRIMARY_WORKTREE", 409),
      );
      await f.service.createWorktree("p", ".", "gone");
      await f.service.removeWorktree("p", ".worktrees/gone", {
        force: false,
        deleteBranch: true,
      });
      assert.equal(
        (await f.git(f.work, "branch", "--list", "gone")).trim(),
        "",
      );
    });
  });

  it("only the primary checkout switches to base", async () => {
    await withFixture(async (f) => {
      const created = await f.service.createWorktree("p", ".", "feature/z");
      await assert.rejects(
        f.service.switchBaseAndPull("p", created.repo.relativePath),
        rejectsWith("GIT_LINKED_WORKTREE", 409),
      );
      const linkedDir = join(f.work, ".worktrees", "feature-z");
      assert.equal(
        (await f.git(linkedDir, "branch", "--show-current")).trim(),
        "feature/z",
      );
    });
  });

  it("bulk guard keeps only primary checkouts", async () => {
    await withFixture(async (f) => {
      await f.service.createWorktree("p", ".", "linked");
      assert.deepEqual(
        await f.service.primaryWorktreeRepos("p", [".worktrees/linked", "."]),
        ["."],
      );
    });
  });
});
