import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalToolWorkerService } from "../../../src/domains/conversations/timeline/canonical-tool-worker.service.js";

test("concurrent tool-result settlement conflicts retry against current group authority", async () => {
  const now = "2026-09-16T00:00:00.000Z";
  const terminal = {
    id: "tool_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "read",
    providerToolCallId: "provider_test",
    runId: "run_test",
    risk: "read",
    args: { path: "README.md" },
    cwd: "/tmp",
    status: "completed",
    phase: "completed",
    revision: 2,
    attempt: 1,
    interactions: [],
    result: { content: "hello" },
    createdAt: now,
    updatedAt: now,
    settledAt: now,
  };
  const snapshot = {
    runId: "run_test",
    effect: {
      effectId: "effect_test",
      memberId: "member_test",
      normalizedInputFingerprint: `sha256:${"a".repeat(64)}`,
    },
    attempt: { attemptId: "attempt_test" },
    waitGroup: {
      members: [{ memberId: "member_test", ownerId: "tool_test" }],
    },
    work: { inputManifestId: "manifest_tool_input_test" },
  };
  const worker = new CanonicalToolWorkerService(
    {
      execution: {
        async readArtifactManifest() {
          return {
            schemaVersion: 1,
            effectId: "effect_test",
            toolName: "read",
            providerToolCallId: "provider_test",
            normalizedInputFingerprint: `sha256:${"a".repeat(64)}`,
            normalizedInput: { path: "README.md" },
            cwd: "/tmp",
            risk: "read",
            providerIdentity: { provider: "test", model: "test" },
            providerCapability: "stateless_generation",
          };
        },
      },
    } as never,
    { invoke: async () => terminal } as never,
    {} as never,
  );
  (worker as never as { invocation: unknown }).invocation = {
    prepareForDispatch: async () => ({ kind: "ready", snapshot }),
  };
  let settlementAttempts = 0;
  (worker as never as { settlement: unknown }).settlement = {
    commitResult: async () => {
      settlementAttempts += 1;
      return settlementAttempts === 1
        ? {
            kind: "rejected",
            outcome: { kind: "cas_conflict", current: [], retry: "reload_and_revalidate" },
          }
        : {
            kind: "committed",
            resultEntryId: "entry_tool_result_test",
            continuationScheduled: true,
          };
    },
  };

  const result = await worker.execute({
    agent: {
      id: "agent_test",
      conversationId: "conv_test",
      projectId: "proj_test",
    } as never,
    claimWork: {} as never,
    workerId: "worker_test",
    now,
    revalidatePolicy: async () => true,
  });

  assert.equal(result.status, "completed");
  assert.equal(settlementAttempts, 2);
});
