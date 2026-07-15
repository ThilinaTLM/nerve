import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "$lib/api";
import {
  AgentConfigMutationQueue,
  type AgentConfigPatch,
} from "./agent-config-mutation-queue";

function agentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent_1",
    thinkingLevel: "off",
    mode: "coding",
    permissionLevel: "workspace_write",
    approvalPolicy: { autoApproveReadOnly: true },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentRecord;
}

interface PendingConfigure {
  agentId: string;
  patch: AgentConfigPatch;
  resolve(agent: AgentRecord): void;
  reject(error: Error): void;
}

function fixture() {
  const pending: PendingConfigure[] = [];
  const desiredHistory: Array<AgentConfigPatch | undefined> = [];
  const confirmed: AgentRecord[] = [];
  const installed: AgentRecord[] = [];
  const failures: AgentConfigPatch[] = [];
  const queue = new AgentConfigMutationQueue({
    configure: (agentId, patch) =>
      new Promise<AgentRecord>((resolve, reject) => {
        pending.push({ agentId, patch, resolve, reject });
      }),
    onDesiredChanged: (_agentId, desired) => {
      desiredHistory.push(desired);
    },
    onAgentRecord: (agent) => installed.push(agent),
    onConfirmed: (_agentId, agent) => confirmed.push(agent),
    onFailed: (_agentId, _error, failed) => failures.push(failed),
  });
  return { queue, pending, desiredHistory, confirmed, installed, failures };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("agent config mutation queue", () => {
  it("publishes the desired state synchronously on enqueue", () => {
    const { queue, desiredHistory } = fixture();
    queue.enqueue("agent_1", { thinkingLevel: "high" });
    assert.deepEqual(queue.desired("agent_1"), { thinkingLevel: "high" });
    assert.deepEqual(desiredHistory, [{ thinkingLevel: "high" }]);
  });

  it("coalesces rapid edits into one request", async () => {
    const { queue, pending, confirmed } = fixture();
    queue.enqueue("agent_1", {
      model: { provider: "a", modelId: "one" },
    });
    queue.enqueue("agent_1", {
      model: { provider: "b", modelId: "two" },
      thinkingLevel: "low",
    });
    await settle();
    // Rapid A -> B selection produced a single runtime request carrying B.
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0]?.patch, {
      model: { provider: "b", modelId: "two" },
      thinkingLevel: "low",
    });
    pending[0]?.resolve(agentRecord({ thinkingLevel: "low" }));
    await settle();
    assert.equal(queue.desired("agent_1"), undefined);
    assert.equal(confirmed.length, 1);
  });

  it("serializes the mode patch before the runtime patch", async () => {
    const { queue, pending, confirmed, installed } = fixture();
    queue.enqueue("agent_1", {
      mode: "planning",
      permissionLevel: "read_only",
    });
    await settle();
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0]?.patch, { mode: "planning" });
    pending[0]?.resolve(agentRecord({ mode: "planning" }));
    await settle();
    assert.equal(pending.length, 2);
    assert.deepEqual(pending[1]?.patch, { permissionLevel: "read_only" });
    pending[1]?.resolve(
      agentRecord({ mode: "planning", permissionLevel: "read_only" }),
    );
    await settle();
    assert.equal(installed.length, 2);
    assert.equal(confirmed.length, 1);
    assert.equal(queue.desired("agent_1"), undefined);
  });

  it("keeps a newer intent published when it arrives in flight", async () => {
    const { queue, pending, confirmed } = fixture();
    queue.enqueue("agent_1", { thinkingLevel: "low" });
    await settle();
    assert.equal(pending.length, 1);
    // Newer edit arrives while the first request is in flight.
    queue.enqueue("agent_1", { thinkingLevel: "high" });
    pending[0]?.resolve(agentRecord({ thinkingLevel: "low" }));
    await settle();
    // The stale response did not clear the newer intent; a follow-up request
    // carries the newest desired state.
    assert.deepEqual(queue.desired("agent_1"), { thinkingLevel: "high" });
    assert.equal(confirmed.length, 0);
    assert.equal(pending.length, 2);
    assert.deepEqual(pending[1]?.patch, { thinkingLevel: "high" });
    pending[1]?.resolve(agentRecord({ thinkingLevel: "high" }));
    await settle();
    assert.equal(queue.desired("agent_1"), undefined);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0]?.thinkingLevel, "high");
  });

  it("keeps a partial mode success when the following runtime patch fails", async () => {
    const { queue, pending, failures, installed, confirmed } = fixture();
    queue.enqueue("agent_1", {
      mode: "planning",
      permissionLevel: "read_only",
    });
    await settle();
    pending[0]?.resolve(agentRecord({ mode: "planning" }));
    await settle();
    pending[1]?.reject(new Error("runtime update failed"));
    await settle();
    assert.equal(installed.length, 1);
    assert.equal(installed[0]?.mode, "planning");
    assert.deepEqual(failures, [
      { mode: "planning", permissionLevel: "read_only" },
    ]);
    assert.equal(queue.desired("agent_1"), undefined);
    assert.equal(confirmed.length, 0);
  });

  it("clears only the failed desired state and reports the failure", async () => {
    const { queue, pending, failures } = fixture();
    queue.enqueue("agent_1", { thinkingLevel: "low" });
    await settle();
    // A newer mode edit arrives while the failing request is in flight.
    queue.enqueue("agent_1", { mode: "planning" });
    pending[0]?.reject(new Error("offline"));
    await settle();
    assert.deepEqual(failures, [{ thinkingLevel: "low" }]);
    // The re-edited field survives and is retried.
    const latest = pending.at(-1);
    assert.deepEqual(latest?.patch, { mode: "planning" });
    latest?.resolve(agentRecord({ mode: "planning" }));
    await settle();
    assert.equal(queue.desired("agent_1"), undefined);
  });

  it("rolls back cleanly when every desired field failed", async () => {
    const { queue, pending, failures, confirmed } = fixture();
    queue.enqueue("agent_1", { permissionLevel: "read_only" });
    await settle();
    pending[0]?.reject(new Error("offline"));
    await settle();
    assert.deepEqual(failures, [{ permissionLevel: "read_only" }]);
    assert.equal(queue.desired("agent_1"), undefined);
    assert.equal(confirmed.length, 0);
    assert.equal(pending.length, 1);
  });

  it("flush resolves once pending mutations settle", async () => {
    const { queue, pending } = fixture();
    queue.enqueue("agent_1", { thinkingLevel: "high" });
    let flushed = false;
    const flushPromise = queue.flush("agent_1").then(() => {
      flushed = true;
    });
    await settle();
    assert.equal(flushed, false);
    pending[0]?.resolve(agentRecord({ thinkingLevel: "high" }));
    await flushPromise;
    assert.equal(flushed, true);
    // Flushing an idle agent resolves immediately.
    await queue.flush("agent_1");
    await queue.flush("agent_unknown");
  });

  it("runs independent agents concurrently without cross-talk", async () => {
    const { queue, pending } = fixture();
    queue.enqueue("agent_1", { thinkingLevel: "high" });
    queue.enqueue("agent_2", { mode: "planning" });
    await settle();
    assert.equal(pending.length, 2);
    assert.deepEqual(
      pending.map((request) => request.agentId),
      ["agent_1", "agent_2"],
    );
  });
});
