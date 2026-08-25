import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settleMeasuredHydrationOperations } from "../src/app/runtime/registry.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("registry store hydration timings", () => {
  it("starts operations concurrently and records each duration", async () => {
    let clock = 100;
    const auth = deferred();
    const tasks = deferred();
    const started: string[] = [];
    const result = settleMeasuredHydrationOperations(
      [
        {
          name: "auth",
          run: () => {
            started.push("auth");
            return auth.promise;
          },
        },
        {
          name: "tasks",
          run: () => {
            started.push("tasks");
            return tasks.promise;
          },
        },
      ],
      () => clock,
    );

    assert.deepEqual(started, ["auth", "tasks"]);
    clock = 135;
    auth.resolve();
    await Promise.resolve();
    clock = 180;
    tasks.resolve();

    const durations = await result;
    assert.equal(durations.auth, 35);
    assert.equal(durations.tasks, 80);
    assert.equal(durations.tools, 0);
  });

  it("settles every operation and rethrows the first rejection by input order", async () => {
    const first = deferred();
    const second = deferred();
    let secondSettled = false;
    const result = settleMeasuredHydrationOperations([
      { name: "auth", run: () => first.promise },
      {
        name: "tasks",
        run: async () => {
          await second.promise;
          secondSettled = true;
        },
      },
    ]);

    first.reject(new Error("auth failed"));
    await Promise.resolve();
    let rejected = false;
    void result.catch(() => {
      rejected = true;
    });
    await Promise.resolve();
    assert.equal(rejected, false);

    second.resolve();
    await assert.rejects(result, /auth failed/);
    assert.equal(secondSettled, true);
  });
});
