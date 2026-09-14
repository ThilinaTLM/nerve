import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import { CanonicalExecutionRuntime } from "../../../src/domains/agents/execution/canonical-execution-runtime.js";

const work: CanonicalLifecycleWork = {
  schemaVersion: 1,
  workId: "canonical_work_cancel_provider",
  conversationId: "conv_cancel_provider",
  runId: "run_cancel_provider",
  kind: "prepare_provider_request",
  providerPhaseId: "provider_phase_cancel_provider",
  state: "leased",
  inputHash: `sha256:${"a".repeat(64)}`,
  generation: 1,
  revision: 2,
  leaseOwner: "worker_cancel",
  leaseDeadline: "2026-09-15T00:01:00.000Z",
  notBefore: "2026-09-15T00:00:00.000Z",
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

test("canonical cancellation propagates an immediate process-local abort hint", async () => {
  let invokedSignal: AbortSignal | undefined;
  const runtime = new CanonicalExecutionRuntime({
    live: {
      execute: ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((_resolve, reject) => {
          invokedSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    },
    mechanics: { activeToolNamesFor: async () => [] },
    getAgentForConversation: () => ({ id: "agent_cancel" }),
    getConversationCreatedAt: () => "2026-09-15T00:00:00.000Z",
  } as never);
  const execution = runtime.handlers.prepare_provider_request?.(work);
  assert.ok(execution);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(invokedSignal);
  assert.equal(invokedSignal.aborted, false);
  runtime.abortRun(work.runId, "explicit_test_cancellation");
  await assert.rejects(execution, /explicit_test_cancellation/);
  assert.equal(invokedSignal.aborted, true);
});
