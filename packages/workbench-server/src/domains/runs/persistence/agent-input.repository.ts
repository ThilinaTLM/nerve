import { parseAgentInputQueueState } from "@nervekit/contracts/agents";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import type {
  AgentInputQueueState,
  AgentInputStore,
} from "../runtime/agent-inputs.js";

/** Narrow canonical document, not a journal-derived projection. One document is the transactional per-agent queue. */
export class AgentInputRepository implements AgentInputStore {
  constructor(
    private readonly storage: Pick<InitializedStorage, "canonicalStore">,
  ) {}
  async load(agentId: string): Promise<AgentInputQueueState | undefined> {
    const document =
      await this.storage.canonicalStore.readDocument<AgentInputQueueState>(
        "agent_inputs",
        "global",
        agentId,
      );
    if (!document) return undefined;
    return parseAgentInputQueueState(document.data, {
      agentId,
      documentRevision: document.revision,
    });
  }
  async save(
    agentId: string,
    state: AgentInputQueueState,
    expectedRevision: number,
  ): Promise<void> {
    await this.storage.canonicalStore.writeDocument({
      namespace: "agent_inputs",
      scopeId: "global",
      documentId: agentId,
      data: parseAgentInputQueueState(state, {
        agentId,
        documentRevision: expectedRevision + 1,
      }),
      expectedRevision,
      now: new Date().toISOString(),
    });
  }
}
