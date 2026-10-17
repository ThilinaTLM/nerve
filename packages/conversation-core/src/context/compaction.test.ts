import assert from "node:assert/strict";
import test from "node:test";
import type { PiModel } from "../ports.js";
import { shouldCompact } from "./compaction.js";

const model = { contextWindow: 100_000 } as PiModel;

void test("shouldCompact honors resolved settings, including disabled auto-compaction", () => {
  assert.equal(shouldCompact(85_000, model), true);
  const custom = {
    auto: true,
    profile: "custom",
    customTriggerPercent: 60,
  } as const;
  assert.equal(shouldCompact(65_000, model, custom), true);
  assert.equal(
    shouldCompact(85_000, model, { ...custom, profile: "conservative" }),
    false,
  );
  assert.equal(shouldCompact(99_000, model, { ...custom, auto: false }), false);
});
