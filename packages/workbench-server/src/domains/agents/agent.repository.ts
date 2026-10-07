import {
  type AgentRecord,
  type AgentConfigurationAcceptance,
  agentRecordSchema,
  agentContextBindingSchema,
  resolveAgentBlueprint,
} from "@nervekit/contracts/agents";
import { preserveLegacyRootContext } from "./agent-context-migration.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";

export class AgentRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async loadAll(): Promise<AgentRecord[]> {
    const documents = await this.storage.canonicalStore.listDocuments<unknown>(
      "agent",
      "global",
    );
    // Stable ordering ensures the historical lead wins, independent of SQL enumeration.
    const records = documents
      .map((document) => agentRecordSchema.parse(document.data))
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    const agents: AgentRecord[] = [];
    for (const record of records) {
      const agent = await this.bindContextOwner(
        resolveAgentBlueprint(record),
        records,
        true,
      );
      const document = documents.find(
        (candidate) => candidate.documentId === agent.id,
      );
      if (JSON.stringify(agent) !== JSON.stringify(document?.data))
        await this.write(agent);
      agents.push(agent);
    }
    return agents;
  }

  async bindContextOwner(
    agent: AgentRecord,
    historical?: readonly AgentRecord[],
    migration = false,
  ): Promise<AgentRecord> {
    if (
      agent.contextOwnerAgentId !== undefined &&
      agent.contextOwnerAgentId !== null
    ) {
      if (agent.contextOwnerAgentId !== agent.id)
        throw new Error("Agent context partition must belong to that agent");
      return agent;
    }
    const isChild =
      agent.contextOwnerAgentId === undefined &&
      (Boolean(agent.parentAgentId) ||
        agent.rootAgentId !== agent.id ||
        (migration &&
          resolveAgentBlueprint(agent).orchestrationPolicy?.preset !==
            "standard"));
    if (isChild) return { ...agent, contextOwnerAgentId: agent.id };
    const store = this.storage.canonicalStore;
    let binding = await store.readDocument<{ legacyRootAgentId: string }>(
      "agent-context-binding",
      "global",
      agent.conversationId,
    );
    if (!binding) {
      const candidates =
        historical ??
        (await store.listDocuments<unknown>("agent", "global")).map(
          (document) => agentRecordSchema.parse(document.data),
        );
      const roots = candidates.filter((candidate) => {
        // Legacy preset decoding is permitted only during historical migration.
        // Live binding never lets a stale kind override explicit configuration.
        const preset = migration
          ? resolveAgentBlueprint(candidate).orchestrationPolicy?.preset
          : (candidate.orchestrationPolicy?.preset ?? "standard");
        return (
          candidate.conversationId === agent.conversationId &&
          !candidate.parentAgentId &&
          candidate.rootAgentId === candidate.id &&
          preset === "standard" &&
          candidate.contextOwnerAgentId !== candidate.id
        );
      });
      const explicitLead = roots.find(
        (candidate) => candidate.contextOwnerAgentId === null,
      );
      const conversation = await store.readDocument<{ activeAgentId?: string }>(
        "conversation",
        "global",
        agent.conversationId,
      );
      const activeLead = roots.find(
        (candidate) => candidate.id === conversation?.data.activeAgentId,
      );
      const lead =
        explicitLead ??
        activeLead ??
        [...roots, agent].sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        )[0];
      try {
        await store.writeDocument({
          namespace: "agent-context-binding",
          scopeId: "global",
          documentId: agent.conversationId,
          data: { legacyRootAgentId: lead?.id ?? agent.id },
          expectedRevision: 0,
          now: agent.createdAt,
        });
      } catch (error) {
        // Concurrent creation may have durably established the same conversation binding.
        if (
          !(await store.readDocument(
            "agent-context-binding",
            "global",
            agent.conversationId,
          ))
        )
          throw error;
      }
      binding = await store.readDocument<{ legacyRootAgentId: string }>(
        "agent-context-binding",
        "global",
        agent.conversationId,
      );
    }
    if (!binding) throw new Error("Missing persisted agent context binding");
    const identity = agentContextBindingSchema.parse(binding.data);
    if (migration && identity.legacyRootAgentId !== agent.id) {
      await preserveLegacyRootContext(this.storage, agent);
    }
    return {
      ...agent,
      contextOwnerAgentId:
        identity.legacyRootAgentId === agent.id ? null : agent.id,
    };
  }

  async write(agent: AgentRecord): Promise<void> {
    const parsed = await this.bindContextOwner(
      resolveAgentBlueprint(agentRecordSchema.parse(agent)),
    );
    const current = await this.storage.canonicalStore.readDocument(
      "agent",
      "global",
      parsed.id,
    );
    const existingOwner = (current?.data as AgentRecord | undefined)
      ?.contextOwnerAgentId;
    if (
      existingOwner !== undefined &&
      (existingOwner !== parsed.contextOwnerAgentId ||
        (agent.contextOwnerAgentId !== undefined &&
          existingOwner !== agent.contextOwnerAgentId))
    ) {
      throw new Error("Agent context ownership is immutable");
    }
    const previous = current
      ? agentRecordSchema.parse(current.data)
      : undefined;
    const receipts = parsed.configurationAcceptances ?? [];
    const previousReceipts = previous?.configurationAcceptances ?? [];
    if (
      receipts.some(
        (receipt) =>
          receipt.configurationRevision > (parsed.configurationRevision ?? 1),
      ) ||
      previousReceipts.some(
        (receipt, index) =>
          JSON.stringify(receipt) !== JSON.stringify(receipts[index]),
      )
    )
      throw new Error(
        "Configuration acceptance receipts are immutable and bounded by accepted revision",
      );
    const added = receipts.slice(previousReceipts.length);
    if (
      previous &&
      added.some(
        (receipt) =>
          receipt.configurationRevision <=
          (previous.configurationRevision ?? 1),
      )
    )
      throw new Error(
        "Cannot invent acceptance provenance for an already committed revision",
      );
    if (
      previous &&
      parsed.configurationRevision !== previous.configurationRevision &&
      previous.configurationAcceptances !== undefined &&
      receipts.at(-1)?.configurationRevision !== parsed.configurationRevision
    )
      throw new Error(
        "New configuration revision requires its exact acceptance receipt",
      );
    await this.storage.canonicalStore.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: parsed.id,
      data: parsed,
      expectedRevision: current?.revision ?? 0,
      now: parsed.updatedAt,
    });
  }

  /** Exact durable provenance, including superseded revisions; never infer actors. */
  async listConfigurationAcceptances(
    agentId?: string,
  ): Promise<AgentConfigurationAcceptance[]> {
    const store = this.storage.canonicalStore;
    const documents = agentId
      ? [await store.readDocument<unknown>("agent", "global", agentId)].filter(
          (document) => document !== undefined,
        )
      : await store.listDocuments<unknown>("agent", "global");
    return documents
      .flatMap((document) => {
        const agent = agentRecordSchema.parse(document.data);
        if (
          agent.id !== document.documentId ||
          (agent.configurationAcceptances ?? []).some(
            (receipt) =>
              receipt.configurationRevision >
              (agent.configurationRevision ?? 1),
          )
        )
          throw new Error(
            "Configuration acceptance document identity/revision mismatch",
          );
        return agent.configurationAcceptances ?? [];
      })
      .sort(
        (a, b) =>
          a.agentId.localeCompare(b.agentId) ||
          a.configurationRevision - b.configurationRevision,
      );
  }

  async remove(agentId: string): Promise<void> {
    await this.storage.canonicalStore.deleteDocument(
      "agent",
      "global",
      agentId,
    );
  }
}
