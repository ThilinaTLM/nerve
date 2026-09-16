import assert from "node:assert/strict";
import test from "node:test";
import { CanonicalToolInvocationService } from "../../../src/domains/conversations/timeline/canonical-tool-invocation.service.js";

test("parallel tool authority conflicts retry without repeating policy evaluation", async () => {
  let policyEvaluations = 0;
  let markAttempts = 0;
  let authorizationLeaseMs = 0;
  let dispatchLeaseMs = 0;
  const dispatchWork = {
    schemaVersion: 1,
    workId: "canonical_work_tool_dispatch_1",
    conversationId: "conv_test",
    runId: "run_test",
    kind: "dispatch_tool_attempt",
    effectId: "effect_test",
    state: "leased",
    inputHash: `sha256:${"a".repeat(64)}`,
    generation: 1,
    revision: 2,
    notBefore: "2026-09-16T00:00:00.000Z",
    leaseOwner: "worker_test",
    leaseDeadline: "2026-09-16T00:01:00.000Z",
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
  const snapshot = {
    work: { ...dispatchWork, state: "ready", generation: 0, revision: 1 },
  };
  const dispatch = {
    async authorizeFirstAttempt(input: { claimLeaseDurationMs: number }) {
      authorizationLeaseMs = input.claimLeaseDurationMs;
      return { kind: "committed", snapshot };
    },
    async markDispatched() {
      markAttempts += 1;
      return markAttempts === 1
        ? {
            kind: "rejected",
            outcome: { kind: "superseded", reason: "run_fence_changed" },
          }
        : { kind: "committed", snapshot: { ...snapshot, work: dispatchWork } };
    },
    async revalidateBeforeDispatch() {
      return true;
    },
  };
  const service = new CanonicalToolInvocationService(
    {
      execution: {
        async readEffect() {
          return {
            effectId: "effect_test",
            authorizationId: "authorization_test",
            normalizedInputFingerprint: `sha256:${"a".repeat(64)}`,
            owner: { agentId: "agent_test" },
          };
        },
        async claimReadyLifecycleWork(input: { leaseDurationMs: number }) {
          dispatchLeaseMs = input.leaseDurationMs;
          return dispatchWork;
        },
      },
    } as never,
    dispatch as never,
    { close: async () => ({ kind: "committed" }) } as never,
  );

  const result = await service.prepareForDispatch({
    claimWork: {
      ...dispatchWork,
      workId: "canonical_work_tool_claim",
      kind: "claim_tool_attempt",
      state: "leased",
    } as never,
    workerId: "worker_test",
    now: "2026-09-16T00:00:00.000Z",
    async revalidatePolicy() {
      policyEvaluations += 1;
      return true;
    },
  });

  assert.equal(result.kind, "ready");
  assert.equal(markAttempts, 2);
  assert.equal(policyEvaluations, 1);
  assert.equal(authorizationLeaseMs, 300_000);
  assert.equal(dispatchLeaseMs, 300_000);
});
