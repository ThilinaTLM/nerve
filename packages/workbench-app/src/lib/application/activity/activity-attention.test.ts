import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import { ActivityAttention } from "./activity-attention.js";
const failure = (id: string): Activity => ({
  id,
  kind: "test",
  title: id,
  status: "failed",
  revision: 1,
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  actions: { cancel: false, retry: false },
});

test("opening marks failures seen and arrivals while open stay seen after closing", () => {
  const attention = new ActivityAttention();
  const first = failure("first"),
    second = failure("second");
  assert.equal(attention.update([first], false), true);
  assert.equal(attention.update([first], true), false);
  assert.equal(attention.update([first, second], true), false);
  assert.equal(attention.update([first, second], false), false);
  assert.equal(
    attention.update([first, second, failure("later")], false),
    true,
  );
});

test("dismissed failures release seen state and interrupted records need attention", () => {
  const attention = new ActivityAttention();
  const entry = failure("same");
  assert.equal(attention.update([entry], true), false);
  assert.equal(attention.update([], false), false);
  assert.equal(attention.update([entry], false), true);
  assert.equal(
    attention.update([{ ...failure("lost"), status: "interrupted" }], false),
    true,
  );
});
