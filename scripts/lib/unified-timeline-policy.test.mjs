import assert from "node:assert/strict";
import test from "node:test";
import { unifiedTimelinePolicyViolations } from "./unified-timeline-policy.mjs";

test("unified timeline runtime cannot import source migration readers", () => {
  assert.deepEqual(
    unifiedTimelinePolicyViolations(
      "packages/workbench-server/src/domains/runs/runtime/example.ts",
      'import "../../../infrastructure/migrations/unified-timeline/v4.js";',
    ),
    ["target runtime must not import unified-timeline source readers"],
  );
});

test("canonical timeline rejects retired transcript authorities", () => {
  assert.deepEqual(
    unifiedTimelinePolicyViolations(
      "packages/workbench-server/src/domains/conversations/timeline/store.ts",
      'const kind = "model_context.leaf_changed";',
    ),
    ["canonical timeline uses retired authority: model_context.leaf_changed"],
  );
});

test("migration modules may retain source-format vocabulary", () => {
  assert.deepEqual(
    unifiedTimelinePolicyViolations(
      "packages/workbench-server/src/infrastructure/migrations/unified-timeline/v4.ts",
      'const kind = "model_context.entry_appended";',
    ),
    [],
  );
});
