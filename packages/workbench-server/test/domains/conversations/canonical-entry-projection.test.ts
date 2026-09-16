import assert from "node:assert/strict";
import test from "node:test";
import { projectCanonicalEntry } from "../../../src/domains/conversations/timeline/canonical-entry-projection.js";

test("canonical tool-result entries preserve their tool identity in the public projection", () => {
  const projected = projectCanonicalEntry({
    schemaVersion: 1,
    entryId: "entry_tool_result_test",
    conversationId: "conv_test",
    transitionId: "transition_test",
    ordinal: 1,
    parentEntryId: null,
    kind: "tool_result",
    inlineContent: { failed: false },
    artifacts: [],
    runId: "run_test",
    toolCallId: "tool_test",
    provenance: {},
  });

  assert.deepEqual(projected.details, { toolRecordId: "tool_test" });
});
