import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { CanonicalChildExecutionService } from "../../../src/domains/agents/execution/canonical-child-execution.service.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const parent = {
  id: "agent_parent_replay",
  conversationId: "conv_parent_replay",
} as AgentRecord;
const child = {
  id: "agent_child_replay",
  conversationId: "conv_child_replay",
} as AgentRecord;

test("INV-AGENT-01 replays a completed child result without redispatch", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-child-replay-"));
  const storage = await initializeStorage(home);
  let dispatches = 0;
  const service = new CanonicalChildExecutionService({
    store: storage.canonicalStore,
    run: async () => {
      dispatches += 1;
      return "durable child report";
    },
  });
  const input = {
    parent,
    parentRunId: "run_parent_replay",
    parentToolCallId: "tool_parent_replay",
    child,
    childRunId: "run_child_replay",
    prompt: "Inspect independently.",
  };
  try {
    assert.equal(await service.run(input), "durable child report");
    assert.equal(await service.run(input), "durable child report");
    assert.equal(dispatches, 1);
    const [relationship] = await service.listForParentRun(input.parentRunId);
    assert.equal(relationship?.state, "completed");
    assert.equal(relationship?.terminalOutcome, "completed");
    assert.equal(relationship?.dispatchEvidence, "dispatch_started");
    assert.equal(relationship?.attachmentState, "detached");
    assert.equal(relationship?.resultText, "durable child report");
  } finally {
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  }
});
