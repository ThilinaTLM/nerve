import assert from "node:assert/strict";
import { it } from "node:test";
import type {
  AgentAsyncObligation,
  AgentRecord,
} from "@nervekit/contracts/agents";
import { AsyncSubagentObligationAdapter } from "../../../src/domains/agents/async-obligation-source-adapters.js";

it("reports the immutable submitted run/attempt snapshot, never a later assignment's output", async () => {
  const child = {
    id: "agent_child",
    name: "API",
    conversationId: "conv_team",
  } as AgentRecord;
  const adapter = new AsyncSubagentObligationAdapter({
    getAgent: () => child,
    generation: async () => ({ generation: 1, stopped: false }),
  });
  const obligation: AgentAsyncObligation = {
    id: "async_subagent:run_first:1",
    conversationId: "conv_team",
    ownerAgentId: "agent_lead",
    sourceKind: "async_subagent",
    sourceId: "run_first",
    sourceAgentId: child.id,
    state: "ready",
    notificationEntryId: "entry_notice",
    generation: 1,
    outcome: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    completion: {
      agentId: child.id,
      runId: "run_first",
      attemptId: "exec_first:1",
      outcome: "completed",
      completedAt: "2026-01-01T00:00:01.000Z",
      response: {
        entryId: "entry_first",
        runId: "run_first",
        text: "original result",
        complete: true,
      },
    },
  };
  const notice = await adapter.buildNotice(obligation);
  assert.match(notice.entry.text!, /original result/);
  assert.match(notice.entry.text!, /untrusted result data/);
  assert.equal(
    (notice.entry.details as { childAttemptId: string }).childAttemptId,
    "exec_first:1",
  );
  assert.equal(await adapter.allow(obligation), true);
});
