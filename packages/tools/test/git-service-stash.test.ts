import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "node:test";
import { GitService } from "../src/git/git-service.js";
import { listStashes, parseStashList } from "../src/git/git-stash.js";

const execFileAsync = promisify(execFile);

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: root })).stdout.trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-git-stash-"));
  await git(root, "init");
  await git(root, "config", "user.email", "nerve@example.test");
  await git(root, "config", "user.name", "Nerve Tests");
  await writeFile(join(root, "staged.txt"), "base\n");
  await writeFile(join(root, "unstaged.txt"), "base\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");
  return root;
}

function service(root: string): GitService {
  return GitService.forWorkspace(root, "stash-test");
}

describe("Git stash workflow", () => {
  it("parses machine-readable stash rows and ignores malformed rows", () => {
    assert.deepEqual(
      parseStashList(
        "stash@{0}\u0000abc1234\u0000WIP on main\u00002 minutes ago\ninvalid\n",
      ),
      [
        {
          index: 0,
          ref: "stash@{0}",
          hash: "abc1234",
          message: "WIP on main",
          relativeDate: "2 minutes ago",
        },
      ],
    );
  });

  it("stashes staged and unstaged areas independently", async () => {
    const root = await repository();
    try {
      const instance = service(root);
      await writeFile(join(root, "staged.txt"), "staged\n");
      await git(root, "add", "staged.txt");
      await writeFile(join(root, "unstaged.txt"), "unstaged\n");
      await writeFile(join(root, "untracked.txt"), "untracked\n");

      await instance.createStash("proj_test", ".", "staged");
      assert.equal(
        await git(root, "status", "--short"),
        "M unstaged.txt\n?? untracked.txt",
      );
      assert.equal(await readFile(join(root, "staged.txt"), "utf8"), "base\n");

      await instance.createStash("proj_test", ".", "unstaged");
      assert.equal(await git(root, "status", "--short"), "");
      assert.equal((await listStashes(instance, root)).length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves unstaged worktree content when the same file is also staged", async () => {
    const root = await repository();
    try {
      const instance = service(root);
      await writeFile(join(root, "staged.txt"), "base\nstaged\n");
      await git(root, "add", "staged.txt");
      await writeFile(join(root, "staged.txt"), "base\nstaged\nunstaged\n");

      await instance.createStash("proj_test", ".", "staged", ["staged.txt"]);

      assert.equal(
        await readFile(join(root, "staged.txt"), "utf8"),
        "base\nstaged\nunstaged\n",
      );
      assert.equal(await git(root, "diff", "--cached", "--name-only"), "");
      assert.equal((await listStashes(instance, root)).length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scopes creation, applies with index state, and retains the stash", async () => {
    const root = await repository();
    try {
      const instance = service(root);
      await writeFile(join(root, "staged.txt"), "selected\n");
      await writeFile(join(root, "unstaged.txt"), "sibling\n");

      await instance.createStash("proj_test", ".", "unstaged", ["staged.txt"]);
      assert.equal(await readFile(join(root, "staged.txt"), "utf8"), "base\n");
      assert.equal(
        await readFile(join(root, "unstaged.txt"), "utf8"),
        "sibling\n",
      );

      await git(root, "restore", "unstaged.txt");
      const [entry] = await listStashes(instance, root);
      assert.ok(entry);
      await instance.applyStash("proj_test", ".", entry.index, entry.hash);
      assert.equal(
        await readFile(join(root, "staged.txt"), "utf8"),
        "selected\n",
      );
      assert.equal((await listStashes(instance, root)).length, 1);
      assert.equal(await git(root, "status", "--short"), "M staged.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies staged and unstaged area stashes with the right index state", async () => {
    const root = await repository();
    try {
      const instance = service(root);
      await writeFile(join(root, "staged.txt"), "staged\n");
      await git(root, "add", "staged.txt");
      await writeFile(join(root, "unstaged.txt"), "unstaged\n");
      await instance.createStash("proj_test", ".", "unstaged");
      await git(root, "commit", "-m", "commit staged side");

      let [entry] = await listStashes(instance, root);
      assert.ok(entry);
      await instance.applyStash("proj_test", ".", entry.index, entry.hash);
      assert.equal(await git(root, "status", "--short"), "M unstaged.txt");
      await git(root, "restore", "unstaged.txt");
      await instance.dropStash("proj_test", ".", entry.index, entry.hash);

      await writeFile(join(root, "staged.txt"), "staged again\n");
      await git(root, "add", "staged.txt");
      await instance.createStash("proj_test", ".", "staged");
      [entry] = await listStashes(instance, root);
      assert.ok(entry);
      await instance.applyStash("proj_test", ".", entry.index, entry.hash);
      assert.equal(
        await git(root, "diff", "--cached", "--name-only"),
        "staged.txt",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("drops only a verified target and rejects a shifted stash index", async () => {
    const root = await repository();
    try {
      const instance = service(root);
      await writeFile(join(root, "unstaged.txt"), "first\n");
      await instance.createStash("proj_test", ".", "unstaged");
      await writeFile(join(root, "unstaged.txt"), "second\n");
      await instance.createStash("proj_test", ".", "unstaged");
      const entries = await listStashes(instance, root);
      const newest = entries[0];
      const oldest = entries[1];
      assert.ok(newest && oldest);

      await instance.dropStash("proj_test", ".", newest.index, newest.hash);
      await assert.rejects(
        instance.dropStash("proj_test", ".", oldest.index, oldest.hash),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("stash list changed"),
      );
      assert.equal((await listStashes(instance, root)).length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
