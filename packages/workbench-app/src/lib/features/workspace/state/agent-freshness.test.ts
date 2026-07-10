import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "$lib/api";
import {
  mergeAgentsByUpdatedAt,
  upsertAgentByUpdatedAt,
} from "./agent-freshness";

function agent(
  patch: Partial<AgentRecord> & Pick<AgentRecord, "id" | "updatedAt">,
): AgentRecord {
  const { id, ...rest } = patch;
  return {
    id,
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    rootAgentId: patch.id,
    mode: "coding",
    permissionLevel: "autonomous",
    approvalPolicy: { autoApproveReadOnly: true },
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    thinkingLevel: "off",
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  };
}

describe("agent freshness merging", () => {
  it("preserves a newer current agent when an older snapshot arrives", () => {
    const current = agent({
      id: "agent_01HN0000000000000000000000",
      status: "idle",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const staleIncoming = agent({
      id: current.id,
      status: "awaiting_user",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });

    const merged = mergeAgentsByUpdatedAt([staleIncoming], [current]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "idle");
    assert.equal(merged[0]?.updatedAt, current.updatedAt);
  });

  it("replaces current state when an incoming snapshot is newer", () => {
    const current = agent({
      id: "agent_01HN0000000000000000000000",
      status: "awaiting_user",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const incoming = agent({
      id: current.id,
      status: "running",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    const merged = mergeAgentsByUpdatedAt([incoming], [current]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.status, "running");
    assert.equal(merged[0]?.updatedAt, incoming.updatedAt);
  });

  it("does not retain current agents that are absent from a snapshot", () => {
    const incoming = agent({
      id: "agent_01HN0000000000000000000000",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    const removed = agent({
      id: "agent_01HN0000000000000000000001",
      updatedAt: "2026-01-01T00:00:03.000Z",
    });

    const merged = mergeAgentsByUpdatedAt([incoming], [incoming, removed]);

    assert.deepEqual(
      merged.map((item) => item.id),
      [incoming.id],
    );
  });

  it("upserts event-provided agents without dropping unrelated agents", () => {
    const other = agent({
      id: "agent_01HN0000000000000000000001",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    const incoming = agent({
      id: "agent_01HN0000000000000000000002",
      status: "running",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    const merged = upsertAgentByUpdatedAt(incoming, [other]);

    assert.deepEqual(
      merged.map((item) => item.id),
      [other.id, incoming.id],
    );
  });
});
