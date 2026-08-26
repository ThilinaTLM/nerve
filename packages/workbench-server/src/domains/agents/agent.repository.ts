import { type AgentRecord, agentRecordSchema } from "@nervekit/contracts";
import type { InitializedStorage } from "../../infrastructure/storage/index.js";

export class AgentRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async loadAll(): Promise<AgentRecord[]> {
    return (
      await this.storage.canonicalStore.listDocuments<unknown>(
        "agent",
        "global",
      )
    ).map((document) => agentRecordSchema.parse(document.data));
  }

  async write(agent: AgentRecord): Promise<void> {
    const parsed = agentRecordSchema.parse(agent);
    const current = await this.storage.canonicalStore.readDocument(
      "agent",
      "global",
      parsed.id,
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

  async remove(agentId: string): Promise<void> {
    await this.storage.canonicalStore.deleteDocument(
      "agent",
      "global",
      agentId,
    );
  }
}
