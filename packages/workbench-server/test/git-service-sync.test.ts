import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import type { ProjectRecord } from "@nervekit/contracts";
import { GitService, GitWorkflowError } from "@nervekit/host-runtime/tools";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return stdout;
}

async function configureUser(repoDir: string): Promise<void> {
  await git(repoDir, ["config", "user.email", "test@example.com"]);
  await git(repoDir, ["config", "user.name", "Test User"]);
}

async function commitFile(
  repoDir: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  await writeFile(join(repoDir, path), content);
  await git(repoDir, ["add", path]);
  await git(repoDir, ["commit", "-m", message]);
}

async function createRemoteFixture(): Promise<{
  root: string;
  remoteDir: string;
  localDir: string;
  service: GitService;
}> {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-sync-"));
  const remoteDir = join(root, "remote.git");
  const seedDir = join(root, "seed");
  const localDir = join(root, "local");

  await git(root, ["init", "--bare", remoteDir]);
  await git(root, ["init", seedDir]);
  await configureUser(seedDir);
  await git(seedDir, ["checkout", "-b", "main"]);
  await commitFile(seedDir, "README.md", "initial\n", "initial");
  await git(seedDir, ["remote", "add", "origin", remoteDir]);
  await git(seedDir, ["push", "-u", "origin", "main"]);
  await git(remoteDir, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  await git(root, ["clone", remoteDir, localDir]);
  await configureUser(localDir);

  const project: ProjectRecord = {
    id: "project",
    dir: localDir,
    name: "local",
    createdAt: "",
    updatedAt: "",
  };
  const service = new GitService(() => project);
  return { root, remoteDir, localDir, service };
}

async function withRemoteFixture(
  fn: (
    fixture: Awaited<ReturnType<typeof createRemoteFixture>>,
  ) => Promise<void>,
): Promise<void> {
  const fixture = await createRemoteFixture();
  try {
    await fn(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

async function pushRemoteOnlyCommit(
  root: string,
  remoteDir: string,
  file = "remote.txt",
): Promise<void> {
  const upstreamDir = join(root, `upstream-${Date.now()}`);
  await git(root, ["clone", remoteDir, upstreamDir]);
  await configureUser(upstreamDir);
  await commitFile(upstreamDir, file, "remote change\n", "remote change");
  await git(upstreamDir, ["push"]);
}

describe("GitService.syncBranch", () => {
  it("fetches before pulling remote-only commits", async () => {
    await withRemoteFixture(async ({ root, remoteDir, localDir, service }) => {
      await pushRemoteOnlyCommit(root, remoteDir);

      const before = await git(localDir, [
        "status",
        "--porcelain=v2",
        "--branch",
      ]);
      assert.match(before, /# branch\.ab \+0 -0/);

      const result = await service.syncBranch("project", ".");

      assert.equal(result.repo.ahead, 0);
      assert.equal(result.repo.behind, 0);
      assert.equal(
        await git(localDir, ["show", "HEAD:remote.txt"]),
        "remote change\n",
      );
    });
  });

  it("pushes local ahead commits after fetching", async () => {
    await withRemoteFixture(async ({ root, remoteDir, localDir, service }) => {
      await commitFile(localDir, "ahead.txt", "local change\n", "local change");

      const result = await service.syncBranch("project", ".");

      assert.equal(result.repo.ahead, 0);
      assert.equal(result.repo.behind, 0);

      const verifyDir = join(root, "verify");
      await git(root, ["clone", remoteDir, verifyDir]);
      assert.equal(
        await git(verifyDir, ["show", "HEAD:ahead.txt"]),
        "local change\n",
      );
    });
  });

  it("rejects behind sync on a dirty worktree", async () => {
    await withRemoteFixture(async ({ root, remoteDir, localDir, service }) => {
      await pushRemoteOnlyCommit(root, remoteDir, "behind.txt");
      await writeFile(join(localDir, "dirty.txt"), "dirty\n");

      await assert.rejects(
        () => service.syncBranch("project", "."),
        (error) =>
          error instanceof GitWorkflowError &&
          error.code === "GIT_DIRTY_WORKTREE",
      );

      await assert.rejects(() => git(localDir, ["show", "HEAD:behind.txt"]));
    });
  });
});
