import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  canonicalGitIdentity,
  GitOperationLanes,
} from "../../src/git/git-operation-lanes.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("FIFO includes local reads; unrelated repositories run and network cap is global", async () => {
  const lanes = new GitOperationLanes(2);
  const hold = gate();
  const order: string[] = [];
  const a = lanes.run("a", true, async () => {
    order.push("a1");
    await hold.promise;
  });
  const a2 = lanes.run("a", false, async () => {
    order.push("a2-read");
  });
  const a3 = lanes.run("a", true, async () => {
    order.push("a3");
  });
  const b = lanes.run("b", true, async () => {
    order.push("b");
    await hold.promise;
  });
  const c = lanes.run("c", true, async () => {
    order.push("c");
  });
  const d = lanes.run("d", false, async () => {
    order.push("d-read");
  });
  await tick();
  assert.deepEqual(order, ["a1", "b", "d-read"]);
  hold.release();
  await Promise.all([a, a2, a3, b, c, d]);
  assert.ok(order.indexOf("a2-read") < order.indexOf("a3"));
  assert.ok(order.includes("c"));
});

test("queued/global-wait cancellation releases bounded admission without running", async () => {
  const lanes = new GitOperationLanes(1, 1);
  const hold = gate();
  const active = lanes.run("a", true, () => hold.promise);
  const controller = new AbortController();
  const waiting = lanes.run(
    "b",
    true,
    async () => {
      assert.fail("cancelled job ran");
    },
    controller.signal,
  );
  await assert.rejects(
    lanes.run("c", false, async () => {}),
    /queue is full/,
  );
  controller.abort();
  await assert.rejects(waiting);
  const local = lanes.run("c", false, async () => "ok");
  assert.equal(await local, "ok");
  hold.release();
  await active;
});

test("failures release lanes and permits", async () => {
  const lanes = new GitOperationLanes(1);
  const failed = lanes.run("a", true, async () => {
    throw new Error("failed");
  });
  const next = lanes.run("a", true, async () => 42);
  await assert.rejects(failed, /failed/);
  assert.equal(await next, 42);
});

test("canonical identity unifies symlinks and linked worktrees but isolates submodules", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-lane-"));
  try {
    const main = join(root, "main");
    const linked = join(root, "linked");
    const alias = join(root, "alias");
    await mkdir(join(main, ".git", "worktrees", "linked"), { recursive: true });
    await mkdir(linked);
    await symlink(main, alias, "dir");
    await writeFile(
      join(linked, ".git"),
      "gitdir: ../main/.git/worktrees/linked\n",
    );
    await writeFile(
      join(main, ".git", "worktrees", "linked", "commondir"),
      "../..\n",
    );
    await mkdir(join(main, "submodule"));
    await mkdir(join(main, ".git", "modules", "sub"), { recursive: true });
    await writeFile(
      join(main, "submodule", ".git"),
      "gitdir: ../.git/modules/sub\n",
    );
    const primary = await canonicalGitIdentity(main);
    const worktree = await canonicalGitIdentity(linked);
    assert.deepEqual(await canonicalGitIdentity(alias), primary);
    assert.equal(worktree.commonDir, primary.commonDir);
    assert.notEqual(worktree.gitDir, primary.gitDir);
    assert.notEqual(
      (await canonicalGitIdentity(join(main, "submodule"))).commonDir,
      primary.commonDir,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
