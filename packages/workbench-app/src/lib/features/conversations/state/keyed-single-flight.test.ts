import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeyedSingleFlight } from "./keyed-single-flight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("KeyedSingleFlight", () => {
  it("shares one in-flight task for the same key", async () => {
    const gate = deferred<number>();
    const singleFlight = new KeyedSingleFlight<string, number>();
    let calls = 0;
    const task = () => {
      calls += 1;
      return gate.promise;
    };

    const first = singleFlight.run("conversation", task);
    const second = singleFlight.run("conversation", task);

    assert.equal(first, second);
    assert.equal(calls, 1);
    gate.resolve(42);
    assert.equal(await second, 42);
  });

  it("allows a new task after the prior task settles", async () => {
    const singleFlight = new KeyedSingleFlight<string, number>();
    let calls = 0;

    assert.equal(
      await singleFlight.run("conversation", async () => ++calls),
      1,
    );
    assert.equal(
      await singleFlight.run("conversation", async () => ++calls),
      2,
    );
  });
});
