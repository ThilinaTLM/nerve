import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import {
  checkGitAncestry,
  NativeGitReadError,
  readGitFileDiff,
  readGitRepositoryInfo,
  readGitSnapshot,
  validateGitBranchName,
} from "../../src/index.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  const isolation = await mkdtemp(join(tmpdir(), "nerve-git-fixture-config-"));
  try {
    const empty = join(isolation, "empty");
    await mkdir(empty);
    const config = join(isolation, "config");
    await writeFile(config, "");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_SYSTEM: config,
      GIT_TEMPLATE_DIR: empty,
      GIT_ATTR_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
    await exec(
      "git",
      [
        "-c",
        `core.hooksPath=${empty}`,
        "-c",
        `core.attributesFile=${config}`,
        "-c",
        "commit.gpgSign=false",
        "-c",
        "tag.gpgSign=false",
        "-c",
        "credential.helper=",
        ...args,
      ],
      { cwd, env },
    );
  } finally {
    await rm(isolation, { recursive: true, force: true });
  }
}

async function withRepo(fn: (repo: string) => Promise<void>): Promise<void> {
  const repo = await mkdtemp(join(tmpdir(), "nerve-native-git-"));
  try {
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Nerve Test"]);
    await git(repo, ["config", "user.email", "nerve@example.com"]);
    await writeFile(join(repo, "tracked.txt"), "original\n");
    await git(repo, ["add", "tracked.txt"]);
    await git(repo, ["commit", "-m", "initial"]);
    await fn(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

describe("native Git reads", () => {
  it("reads repository metadata, status, refs, history, and ancestry", async () => {
    await withRepo(async (repo) => {
      await writeFile(join(repo, "tracked.txt"), "modified\n");
      await writeFile(join(repo, "new.txt"), "new\n");
      const info = await readGitRepositoryInfo(repo);
      const snapshot = await readGitSnapshot(repo, { recentCommitLimit: 2 });

      assert.equal(info.bare, false);
      assert.equal(snapshot.headBranch, "main");
      assert.equal(snapshot.recentCommits[0]?.subject, "initial");
      const main = snapshot.refs.find((ref) => ref.name === "refs/heads/main");
      assert.ok(main);
      assert.equal(typeof main.commitTimestampSeconds, "number");
      assert.ok(snapshot.files.some((file) => file.path === "tracked.txt"));
      assert.ok(snapshot.files.some((file) => file.path === "new.txt"));
      assert.equal(
        (await checkGitAncestry(repo, "HEAD", "HEAD")).isAncestor,
        true,
      );
      assert.equal(validateGitBranchName("feature/native-read"), true);
      assert.equal(validateGitBranchName("bad..name"), false);
    });
  });

  it("reads revision, index, and worktree documents", async () => {
    await withRepo(async (repo) => {
      await writeFile(join(repo, "tracked.txt"), "worktree\n");
      const diff = await readGitFileDiff(
        repo,
        { kind: "revision", revision: "HEAD", path: "tracked.txt" },
        { kind: "worktree", path: "tracked.txt" },
      );
      assert.equal(diff.original.content, "original\n");
      assert.equal(diff.modified.content, "worktree\n");
      assert.equal(diff.original.binary, false);
    });
  });

  it("does not block the Node event loop", async () => {
    await withRepo(async (repo) => {
      for (let index = 0; index < 200; index += 1) {
        await writeFile(join(repo, `untracked-${index}.txt`), "x");
      }
      let yielded = false;
      const pending = readGitSnapshot(repo);
      await new Promise<void>((resolve) =>
        setImmediate(() => {
          yielded = true;
          resolve();
        }),
      );
      assert.equal(yielded, true);
      assert.ok((await pending).files.length >= 200);
    });
  });

  it("classifies non-repositories without compatibility ambiguity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nerve-native-not-repo-"));
    try {
      await assert.rejects(readGitRepositoryInfo(dir), (error: unknown) => {
        assert.ok(error instanceof NativeGitReadError);
        assert.equal(error.category, "not_repository");
        return true;
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
