import assert from "node:assert/strict";
import { test } from "node:test";
import { ControllerLifecycle } from "./controller-lifecycle";

test("start is idempotent and dispose runs cleanups latest first", () => {
  const life = new ControllerLifecycle();
  const events: string[] = [];
  assert.equal(
    life.start((scope) => {
      events.push("setup");
      scope.onDispose(() => events.push("a"));
      scope.onDispose(() => events.push("b"));
    }),
    true,
  );
  assert.equal(
    life.start(() => events.push("again")),
    false,
  );
  assert.equal(life.started, true);
  life.dispose();
  assert.equal(life.started, false);
  assert.deepEqual(events, ["setup", "b", "a"]);
  life.dispose();
  assert.deepEqual(events, ["setup", "b", "a"]);
});

test("a superseded scope is stale, guards resolve undefined, late cleanups run now", async () => {
  const life = new ControllerLifecycle();
  let first:
    | Parameters<Parameters<ControllerLifecycle["start"]>[0]>[0]
    | undefined;
  life.start((scope) => {
    first = scope;
  });
  const pending = first!.guard(Promise.resolve("value"));
  life.restart(() => undefined);
  assert.equal(first!.isCurrent(), false);
  assert.equal(await pending, undefined);
  let ran = false;
  first!.onDispose(() => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.equal(life.started, true);
});

test("guard passes through while the scope is current", async () => {
  const life = new ControllerLifecycle();
  let scope:
    | Parameters<Parameters<ControllerLifecycle["start"]>[0]>[0]
    | undefined;
  life.start((s) => {
    scope = s;
  });
  assert.equal(await scope!.guard(Promise.resolve(7)), 7);
});
