import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  inGitLane,
  inGitReadLane,
  withGitNetworkPermit,
} from "../../src/git/git-operation-context.js";
import { gitOperationLanes } from "../../src/git/git-operation-lanes.js";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
void test("whole workflows reenter through aliases without releasing their lane between steps", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-reentry-"));
  const hold = gate();
  const ready = gate();
  const order: string[] = [];
  try {
    await mkdir(join(root, ".git"));
    const alias = join(root, "alias");
    await symlink(root, alias, "dir");
    const workflow = inGitLane(root, true, async () => {
      await inGitLane(alias, false, async () => {
        order.push("fetch");
      });
      ready.release();
      await hold.promise;
      await inGitLane(root, true, async () => {
        order.push("pull");
      });
      await inGitLane(root, true, async () => {
        order.push("push");
      });
    });
    await ready.promise;
    const competing = inGitLane(root, false, async () => {
      order.push("competing-status");
    });
    hold.release();
    await Promise.all([workflow, competing]);
    assert.deepEqual(order, ["fetch", "pull", "push", "competing-status"]);
  } finally {
    hold.release();
    await rm(root, { recursive: true, force: true });
  }
});
void test("independent read admissions cancel queued waits without retaining unrelated keys", async () => {
  const hold = gate();
  const ready = gate();
  const first = inGitReadLane("/test/git/a", async () => {
    ready.release();
    await hold.promise;
  });
  await ready.promise;
  const abort = new AbortController();
  const cancelled = inGitReadLane(
    "/test/git/a",
    async () => {
      assert.fail("cancelled read ran");
    },
    abort.signal,
  );
  assert.equal(await inGitReadLane("/test/git/b", async () => 42), 42);
  abort.abort();
  await assert.rejects(cancelled);
  let ran = false;
  const mutation = gitOperationLanes.run("/test/git/a", true, async () => {
    ran = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ran, false);
  hold.release();
  await Promise.all([first, mutation]);
  assert.equal(ran, true);
});

void test("callbacks from a finished workflow cannot reuse its released lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-lane-lifetime-"));
  const trigger = gate();
  const hold = gate();
  const ready = gate();
  let late!: Promise<void>;
  let lateRan = false;
  try {
    await mkdir(join(root, ".git"));
    await inGitLane(root, false, async () => {
      late = trigger.promise.then(() =>
        inGitLane(root, false, async () => {
          lateRan = true;
        }),
      );
    });
    const next = inGitLane(root, false, async () => {
      ready.release();
      await hold.promise;
    });
    await ready.promise;
    trigger.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(lateRan, false);
    hold.release();
    await Promise.all([next, late]);
    assert.equal(lateRan, true);
  } finally {
    trigger.release();
    hold.release();
    await rm(root, { recursive: true, force: true });
  }
});

void test("HTTP-only network requests and nested CLI workflows share cap four without double permits", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-network-permit-"));
  const hold = gate();
  const ready = gate();
  let started = 0;
  try {
    await mkdir(join(root, ".git"));
    const holders = Array.from({ length: 3 }, () =>
      withGitNetworkPermit(async () => {
        if (++started === 3) ready.release();
        await hold.promise;
      }),
    );
    await ready.promise;
    assert.equal(
      await inGitLane(root, true, () => withGitNetworkPermit(async () => 42)),
      42,
    );
    const fourthReady = gate();
    const fourth = withGitNetworkPermit(async () => {
      fourthReady.release();
      await hold.promise;
    });
    await fourthReady.promise;
    const abort = new AbortController();
    let overflowRan = false;
    const waiting = withGitNetworkPermit(async () => {
      overflowRan = true;
    }, abort.signal);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(overflowRan, false);
    abort.abort();
    await assert.rejects(waiting);
    hold.release();
    await Promise.all([...holders, fourth]);
  } finally {
    hold.release();
    await rm(root, { recursive: true, force: true });
  }
});
