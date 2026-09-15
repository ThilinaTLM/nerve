import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { childExecutionRelationshipSchema } from "@nervekit/contracts/agents";
import { CanonicalChildExecutionService } from "../../../src/domains/agents/execution/canonical-child-execution.service.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const now = "2026-09-15T00:00:00.000Z";

for (const state of ["registered", "running"] as const) {
  test(`INV-AGENT-01 restart reconciles ${state} child evidence without redispatch`, async () => {
    const home = await mkdtemp(join(tmpdir(), `nerve-child-${state}-`));
    const storage = await initializeStorage(home);
    let dispatches = 0;
    const service = new CanonicalChildExecutionService({
      store: storage.canonicalStore,
      run: async () => {
        dispatches += 1;
        return "must not run";
      },
    });
    const relationship = childExecutionRelationshipSchema.parse({
      schemaVersion: 1,
      relationshipId: `childrel_recovery_${state}`,
      parentAgentId: "agent_parent_recovery",
      parentConversationId: "conv_parent_recovery",
      parentRunId: "run_parent_recovery",
      parentToolCallId: "tool_parent_recovery",
      childAgentId: "agent_child_recovery",
      childConversationId: "conv_child_recovery",
      childRunId: `run_child_recovery_${state}`,
      state,
      dispatchEvidence:
        state === "registered" ? "not_dispatched" : "possibly_dispatched",
      attachmentState: "pending",
      ...(state === "running" ? { dispatchStartedAt: now } : {}),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await storage.canonicalStore.writeDocument({
        namespace: "canonical_child_execution",
        scopeId: relationship.parentRunId,
        documentId: relationship.relationshipId,
        data: relationship,
        expectedRevision: 0,
        now,
      });
      await service.recoverPending();
      const [recovered] = await service.listForParentRun(
        relationship.parentRunId,
      );
      assert.equal(recovered?.state, "detached");
      assert.equal(recovered?.attachmentState, "detached");
      if (state === "registered") {
        assert.equal(recovered?.dispatchEvidence, "not_dispatched");
        assert.ok(recovered?.nonDispatchProvenAt);
      } else {
        assert.equal(recovered?.dispatchEvidence, "possibly_dispatched");
        assert.ok(recovered?.cancellationRequestedAt);
      }
      assert.equal(dispatches, 0);
    } finally {
      await storage.canonicalStore.close();
      await rm(home, { recursive: true, force: true });
    }
  });
}
