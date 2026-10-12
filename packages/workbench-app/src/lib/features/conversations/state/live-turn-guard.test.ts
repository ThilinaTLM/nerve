import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveTurnGuard } from "./live-turn-guard";

test("a delayed live snapshot cannot reopen an assistant turn after durable handoff", () => {
  const guard = new LiveTurnGuard();
  assert.equal(guard.accept("turn-1"), true);
  guard.finalize("turn-1");
  assert.equal(guard.accept("turn-1"), false);
  assert.equal(guard.accept("turn-2"), true);
});

test("terminal or head replacement seals active turns without blocking a later execution", () => {
  const guard = new LiveTurnGuard();
  guard.accept("cancelled-turn");
  guard.accept("parallel-turn");
  guard.finalizeActive();
  assert.equal(guard.accept("cancelled-turn"), false);
  assert.equal(guard.accept("parallel-turn"), false);
  assert.equal(guard.accept("new-execution"), true);
});

test("recovery rejects durable turns but allows the current unfinished turn to resume", () => {
  const guard = new LiveTurnGuard();
  guard.accept("unfinished");
  guard.finalizeActive();
  guard.recover(["durable"]);
  assert.equal(guard.accept("durable"), false);
  assert.equal(guard.accept("unfinished"), true);
});
