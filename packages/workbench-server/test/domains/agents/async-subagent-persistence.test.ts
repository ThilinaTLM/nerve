import assert from "node:assert/strict";
import { it } from "node:test";
import { CanonicalDatabase } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-database.js";
import type { AsyncSubagentCompletion } from "@nervekit/contracts/agents";

it("deduplicates child completions and never rolls delivery progress backwards", () => {
  const database = new CanonicalDatabase(":memory:");
  try {
    database.initialize();
    const completion: AsyncSubagentCompletion = {
      childId: "agent_child",
      leadId: "agent_lead",
      runId: "run_child",
      conversationId: "conv_team",
      entryId: "entry_completion",
      outcome: "completed",
      generation: 0,
      createdAt: new Date().toISOString(),
      suppressed: false,
    };
    database.subagentCompletions.put(completion);
    const consumedAt = new Date().toISOString();
    database.subagentCompletions.put({
      ...completion,
      consumedAt,
      deliveredAt: consumedAt,
    });
    database.subagentCompletions.put(completion);
    const records = database.subagentCompletions.list(completion.leadId);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.consumedAt, consumedAt);
    assert.throws(
      () =>
        database.subagentCompletions.put({
          ...completion,
          leadId: "agent_someone_else",
        }),
      /identity conflict/,
    );
    database.subagentCompletions.put({ ...completion, suppressed: true });
    database.subagentCompletions.put(completion);
    assert.equal(database.subagentCompletions.list()[0]?.suppressed, true);
    database.subagentCompletions.removeConversation(completion.conversationId);
    assert.deepEqual(database.subagentCompletions.list(), []);
  } finally {
    database.close();
  }
});
