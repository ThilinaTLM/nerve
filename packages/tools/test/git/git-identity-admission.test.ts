import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { GitIdentityAdmission } from "../../src/git/git-identity-admission.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

void test("unrelated identity work does not wait for a slow path; abort settles promptly", async () => {
  const admission = new GitIdentityAdmission(4, 2);
  const slow = deferred<string>();
  const abort = new AbortController();
  const waiting = admission.run(
    () => slow.promise,
    async () => {
      assert.fail("cancelled lookup executed");
    },
    abort.signal,
  );
  assert.equal(
    await admission.run(
      async () => "other",
      async () => "done",
    ),
    "done",
  );
  abort.abort();
  await assert.rejects(waiting);
  slow.resolve("slow");
  await tick();
});
void test("admission bounds requests BEFORE I/O; queued cancellation releases capacity", async () => {
  const admission = new GitIdentityAdmission(2, 1);
  const slow = deferred<string>();
  let lookups = 0;
  const one = admission.run(
    () => {
      lookups++;
      return slow.promise;
    },
    async () => 1,
  );
  const abort = new AbortController();
  const two = admission.run(
    async () => {
      lookups++;
      return "two";
    },
    async () => 2,
    abort.signal,
  );
  await assert.rejects(
    admission.run(
      async () => {
        assert.fail("overflow lookup ran");
      },
      async () => 3,
    ),
    /admission is full/,
  );
  await tick();
  assert.equal(lookups, 1);
  abort.abort();
  await assert.rejects(two);
  const replacement = admission.run(
    async () => "replacement",
    async () => 4,
  );
  slow.resolve("one");
  assert.equal(await one, 1);
  assert.equal(await replacement, 4);
});
void test("cancel storms cannot accumulate unbounded detached OS lookups", async () => {
  const admission = new GitIdentityAdmission(2, 1);
  const stalled = deferred<string>();
  let lookups = 0;
  const abort = new AbortController();
  const first = admission.run(
    () => {
      lookups++;
      return stalled.promise;
    },
    async () => {},
    abort.signal,
  );
  await tick();
  abort.abort();
  await assert.rejects(first);
  const queued = new AbortController();
  const next = admission.run(
    async () => {
      lookups++;
      return "next";
    },
    async () => {},
    queued.signal,
  );
  await tick();
  assert.equal(lookups, 1);
  queued.abort();
  await assert.rejects(next);
  stalled.resolve("stalled");
  await tick();
  await assert.rejects(
    admission.run(
      async () => {
        throw new Error("bad identity");
      },
      async () => {},
    ),
    /bad identity/,
  );
  assert.equal(
    await admission.run(
      async () => "ok",
      async () => 42,
    ),
    42,
  );
});

void test("same-path waiters share one resolver, retain FIFO, and do not block unrelated admission", async () => {
  const admission = new GitIdentityAdmission(8, 2);
  const slow = deferred<string>();
  const order: number[] = [];
  let lookups = 0;
  const abort = new AbortController();
  let sharedSignal!: AbortSignal;
  const identify = (signal: AbortSignal) => {
    sharedSignal = signal;
    lookups++;
    return slow.promise;
  };
  const cancelled = admission.run(
    identify,
    async () => {
      assert.fail("cancelled waiter executed");
    },
    abort.signal,
    "same",
  );
  const waiters = [1, 2, 3].map((number) =>
    admission.run(
      identify,
      async () => {
        order.push(number);
      },
      undefined,
      "same",
    ),
  );
  await tick();
  assert.equal(lookups, 1);
  assert.equal(
    await admission.run(
      async () => "other",
      async () => "done",
      undefined,
      "other",
    ),
    "done",
  );
  abort.abort();
  await assert.rejects(cancelled);
  assert.equal(sharedSignal.aborted, false);
  slow.resolve("canonical");
  await Promise.all(waiters);
  assert.deepEqual(order, [1, 2, 3]);
});

for (const sharedIdentity of [false, true]) {
  void test(`admission preserves submitter context for ${sharedIdentity ? "shared" : "queued"} identities`, async () => {
    const context = new AsyncLocalStorage<string>();
    const admission = new GitIdentityAdmission(4, 1);
    const hold = deferred<string>();
    const first = context.run("first", () =>
      admission.run(
        () => hold.promise,
        async () => {
          assert.equal(context.getStore(), "first");
        },
        undefined,
        "first",
      ),
    );
    const second = context.run("second", () =>
      admission.run(
        async () => {
          assert.equal(context.getStore(), "second");
          return "second";
        },
        async () => {
          assert.equal(context.getStore(), "second");
        },
        undefined,
        sharedIdentity ? "first" : "second",
      ),
    );
    hold.resolve("first");
    await Promise.all([first, second]);
  });
}
