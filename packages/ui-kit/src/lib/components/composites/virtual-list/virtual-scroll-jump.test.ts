import assert from "node:assert/strict";
import test from "node:test";
import { planJumpToEnd } from "./virtual-scroll-jump";

test("animates the whole way when the end is close", () => {
  assert.deepEqual(planJumpToEnd(900, 500, false), { behavior: "smooth" });
});

test("snaps to one screen above the end before animating from far away", () => {
  assert.deepEqual(planJumpToEnd(250_000, 500, false), {
    preJumpDistance: 500,
    behavior: "smooth",
  });
});

test("jumps instantly when the user prefers reduced motion", () => {
  assert.deepEqual(planJumpToEnd(250_000, 500, true), { behavior: "instant" });
});
