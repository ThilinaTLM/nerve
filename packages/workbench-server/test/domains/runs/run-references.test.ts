import assert from "node:assert/strict";
import test from "node:test";
import { WorkbenchRunReferences } from "../../../src/domains/runs/application/run-references.js";

test("checkpoint references exclude discarded messages and follow the active branch order", async () => {
  const references = new WorkbenchRunReferences(
    {
      load: async () => ({
        run: { conversationId: "conv_test" },
        transitions: [
          { entries: [{ id: "entry_prompt" }, { id: "entry_discarded" }] },
          { entries: [{ id: "entry_retry" }, { id: "entry_result" }] },
        ],
      }),
    } as never,
    {
      openStorage: async () => ({
        getLeafId: async () => "entry_result",
        getPathToRoot: async (leaf: string) => {
          assert.equal(leaf, "entry_result");
          return [
            "entry_older_run",
            "entry_prompt",
            "entry_retry",
            "entry_result",
          ].map((id) => ({ id }));
        },
      }),
    } as never,
    { getConversation: () => ({ id: "conv_test" }) } as never,
  );
  const result = await references.transcript("run_test");
  assert.deepEqual(result.entryIds, [
    "entry_prompt",
    "entry_retry",
    "entry_result",
  ]);
  assert.equal(result.cursor, 3);
  assert.equal(result.harnessLeafId, "entry_result");
});
