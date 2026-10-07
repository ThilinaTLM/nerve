import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentRecordSchema } from "@nervekit/contracts/agents";
import type { InitializedStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { AgentRepository } from "../../../src/domains/agents/agent.repository.js";

const now = "2026-10-06T00:00:00.000Z";
function record(id: string) {
  return agentRecordSchema.parse({
    id,
    rootAgentId: id,
    conversationId: "conv_shared",
    projectId: "proj_test",
    projectDir: "/workspace",
    mode: "coding",
    permissionLevel: "supervised",
    workspaceScope: { roots: ["/workspace"], readonly: false },
    orchestrationPolicy: {
      preset: "standard",
      parentCancellation: "independent",
      completionReporting: "none",
    },
    createdAt: now,
    updatedAt: now,
  });
}

for (const staleKind of ["explore", "async_developer", "root"] as const) {
  test(`live binding follows configured root identity, not stale ${staleKind} kind`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), "nerve-live-agent-binding-"));
    const store = new CanonicalStore(join(home, "canonical.sqlite"), {
      readerCount: 0,
    });
    await store.initialize();
    t.after(async () => {
      await store.close();
      await rm(home, { recursive: true, force: true });
    });
    const storage = {
      paths: { home },
      canonicalStore: store,
    } as InitializedStorage;
    const repository = new AgentRepository(storage);
    const lead = { ...record("agent_lead"), executionKind: staleKind };
    const developer = {
      ...record("agent_developer"),
      executionKind: "root" as const,
      orchestrationPolicy: {
        preset: "developer" as const,
        parentCancellation: "independent" as const,
        completionReporting: "parent" as const,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const child = {
      ...record("agent_child"),
      executionKind: "root" as const,
      parentAgentId: lead.id,
      rootAgentId: lead.id,
    };
    for (const agent of [developer, child, lead]) {
      await store.writeDocument({
        namespace: "agent",
        scopeId: "global",
        documentId: agent.id,
        data: agent,
        expectedRevision: 0,
        now,
      });
    }
    // Even active selection cannot promote a configured developer to historical lead.
    await store.writeDocument({
      namespace: "conversation",
      scopeId: "global",
      documentId: lead.conversationId,
      data: { activeAgentId: developer.id },
      expectedRevision: 0,
      now,
    });
    await repository.write(record("agent_new_root"));
    assert.equal(
      (
        await store.readDocument<{ legacyRootAgentId: string }>(
          "agent-context-binding",
          "global",
          lead.conversationId,
        )
      )?.data.legacyRootAgentId,
      lead.id,
    );
    await repository.write(lead);
    await repository.write(developer);
    await repository.write(child);
    const bound = await repository.loadAll();
    assert.equal(
      bound.find((agent) => agent.id === lead.id)?.contextOwnerAgentId,
      null,
    );
    for (const id of [developer.id, child.id, "agent_new_root"])
      assert.equal(
        bound.find((agent) => agent.id === id)?.contextOwnerAgentId,
        id,
      );
    // Configuration changes cannot relocate an already persisted shared owner.
    await repository.write({
      ...bound.find((agent) => agent.id === lead.id)!,
      orchestrationPolicy: developer.orchestrationPolicy,
    });
    assert.deepEqual(
      (await repository.loadAll()).map((agent) => [
        agent.id,
        agent.contextOwnerAgentId,
      ]),
      bound.map((agent) => [agent.id, agent.contextOwnerAgentId]),
    );
  });
}
