import {
  agentAsyncObligationEntryId,
  type AgentAsyncObligation,
  type AgentInputRecord,
  type AgentRecord,
  type AgentConfigurationAcceptance,
} from "@nervekit/contracts/agents";
import type { AgentAsyncObligationService } from "./agent-async-obligation.service.js";

export interface AgentInterventionPorts {
  getAgent(agentId: string): AgentRecord;
  obligations: Pick<AgentAsyncObligationService, "register" | "recover">;
  warn(error: unknown, sourceId: string): void;
  listConfigurationAcceptances?(): Promise<AgentConfigurationAcceptance[]>;
}

/** Persisted retry intents over the existing obligation path, not a message queue. */
export class AgentInterventionService {
  constructor(private readonly ports: AgentInterventionPorts) {}

  inputAccepted(input: AgentInputRecord): Promise<void> {
    if (input.origin.kind !== "user") return Promise.resolve();
    return this.record(
      input.agentId,
      input.id,
      "submitted input",
      input.acceptedAt,
      { inputId: input.id },
    );
  }

  configurationAccepted(receipt: AgentConfigurationAcceptance): Promise<void> {
    if (receipt.actor.kind !== "user" || !receipt.parentAgentId)
      return Promise.resolve();
    return this.record(
      receipt.agentId,
      `configuration:${receipt.agentId}:${receipt.configurationRevision}`,
      "changed next-turn configuration",
      receipt.acceptedAt,
      { configurationRevision: receipt.configurationRevision },
      {
        parentAgentId: receipt.parentAgentId,
        conversationId: receipt.conversationId,
      },
    );
  }

  async recoverConfigurationAcceptances(): Promise<void> {
    for (const receipt of (await this.ports.listConfigurationAcceptances?.()) ??
      [])
      await this.configurationAccepted(receipt);
  }

  controlAccepted(
    agentId: string,
    generation: number,
    activationState: "enabled" | "paused",
    acceptedAt: string,
  ): Promise<void> {
    return this.record(
      agentId,
      `control:${agentId}:${generation}:${activationState}`,
      activationState === "paused" ? "paused the agent" : "resumed the agent",
      acceptedAt,
      { controlGeneration: generation, activationState },
    );
  }

  deferred(error: unknown, sourceId: string): void {
    try {
      this.ports.warn(error, sourceId);
    } catch {
      /* Diagnostics cannot revoke an already persisted acceptance. */
    }
  }

  private async record(
    agentId: string,
    sourceId: string,
    action: string,
    acceptedAt: string,
    correlation: Record<string, unknown>,
    acceptedScope?: { parentAgentId: string; conversationId: string },
  ): Promise<void> {
    try {
      const parentAgentId =
        acceptedScope?.parentAgentId ??
        this.ports.getAgent(agentId).parentAgentId;
      if (!parentAgentId) return;
      const owner = this.ports.getAgent(parentAgentId);
      if (
        acceptedScope &&
        owner.conversationId !== acceptedScope.conversationId
      )
        throw new Error(
          "Configuration acceptance parent belongs to a different conversation",
        );
      const generation = 0;
      const outcome = JSON.stringify({
        action,
        childId: agentId,
        sourceId,
        ...correlation,
      });
      const obligation: AgentAsyncObligation = {
        id: `user_intervention:${sourceId}:${generation}`,
        sourceKind: "user_intervention",
        sourceId,
        sourceAgentId: agentId,
        ownerAgentId: owner.id,
        conversationId: owner.conversationId,
        generation,
        state: "ready",
        outcome,
        notificationEntryId: agentAsyncObligationEntryId(
          "user_intervention",
          sourceId,
          generation,
        ),
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      };
      await this.ports.obligations.register(obligation);
      await this.ports.obligations.recover();
    } catch (error) {
      // The child acceptance/revision is already durable. A notice producer can
      // fail independently; recovery retries the intent without replaying action.
      this.deferred(error, sourceId);
    }
  }
}
