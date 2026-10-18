import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitService } from "../../src/git/git-service.js";
import {
  inGitCreationLane,
  inGitLane,
} from "../../src/git/git-operation-context.js";

test("containment rejects symlink escapes including not-yet-created clone destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-contain-"));
  try {
    const project = join(root, "project");
    const outside = join(root, "outside");
    await mkdir(project);
    await mkdir(outside);
    await mkdir(join(project, "inside"));
    await symlink(outside, join(project, "escape"), "dir");
    await symlink(join(project, "inside"), join(project, "alias"), "dir");
    const git = GitService.forWorkspace(project);
    assert.throws(() => git.resolveRepoDir("p", "escape"), /outside/);
    assert.throws(() => git.resolveRepoDir("p", "escape/new-clone"), /outside/);
    assert.throws(() => git.resolveRepoDir("p", "../outside"), /outside/);
    assert.equal(
      git.resolveRepoDir("p", "alias/new-clone"),
      join(project, "inside", "new-clone"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clone reservation uses real parent and blocks normal reads after .git appears", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-clone-lane-"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    await symlink(root, join(root, "alias"), "dir");
    const destination = join(root, "new");
    const clone = inGitCreationLane(
      join(root, "alias", "new"),
      true,
      async () => {
        await mkdir(join(destination, ".git"), { recursive: true });
        started();
        await gate;
      },
    );
    await ready;
    let read = false;
    const snapshot = inGitLane(destination, false, async () => {
      read = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(read, false);
    release();
    await Promise.all([clone, snapshot]);
    assert.equal(read, true);
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

void test("clone keeps a remote beginning with '-' behind -- and validates control bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-clone-args-"));
  try {
    const service = GitService.forWorkspace(root);
    const calls: string[][] = [];
    service.runGit = async (_cwd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };
    service.summarizeRepo = async () => ({ relativePath: "new" }) as never;
    await service.clone("proj_test", "new", "--upload-pack=untrusted");
    assert.deepEqual(calls, [
      ["clone", "--", "--upload-pack=untrusted", join(root, "new")],
    ]);
    await assert.rejects(
      service.clone("proj_test", "new", "bad\nremote"),
      /Invalid clone remote/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
