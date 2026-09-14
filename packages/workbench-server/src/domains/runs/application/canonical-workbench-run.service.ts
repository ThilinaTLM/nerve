import { createId } from "@nervekit/contracts";
import type {
  AgentRecord,
  PromptRequest,
  QueuedPromptRecord,
} from "@nervekit/contracts/agents";
import type { ContextUsage } from "@nervekit/contracts/models";
import { ApplicationError } from "../../../core/application-error.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { CanonicalRunStartService } from "../../conversations/timeline/canonical-run-start.service.js";
import { conversationCommandFingerprint } from "../../conversations/timeline/command-fingerprint.js";
import { CanonicalTimelineIdentityService } from "../../conversations/timeline/canonical-timeline-identity.service.js";
import { ConversationTransitionService } from "../../conversations/timeline/conversation-transition.service.js";
import type { CanonicalRunTerminationService } from "../../conversations/timeline/canonical-run-termination.service.js";
import type { WorkbenchAgentMechanics } from "../../agents/execution/workbench-agent-mechanics.js";
import type { ExploreReport } from "../../agents/execution/subagent-runner.js";

export interface CanonicalExecutionWake {
  wake(): void;
}

/** Public run facade backed only by canonical run controls and lifecycle work. */
export class CanonicalWorkbenchRunService {
  private readonly identity: CanonicalTimelineIdentityService;
  private readonly transitions: ConversationTransitionService;

  constructor(
    private readonly deps: {
      state: RuntimeState;
      store: CanonicalStore;
      starts: CanonicalRunStartService;
      termination: CanonicalRunTerminationService;
      mechanics: WorkbenchAgentMechanics;
      execution: CanonicalExecutionWake;
    },
  ) {
    this.identity = new CanonicalTimelineIdentityService(deps.store);
    this.transitions = new ConversationTransitionService(deps.store);
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.deps.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.deps.state.maintenanceScopes.assertProject(agent.projectId);
    if (agent.parentAgentId) {
      throw new ApplicationError(
        409,
        "SUBAGENT_NOT_INTERACTIVE",
        "Sub-agents are managed by their parent run.",
      );
    }
    const head = await this.deps.store.readTimelineConversationHead(
      agent.conversationId,
    );
    if (head?.foregroundRunId) {
      if (request.behavior === "reject-if-busy") {
        throw new ApplicationError(
          409,
          "AGENT_BUSY",
          "Agent is already running.",
        );
      }
      await this.enqueuePrompt(agent, head, request);
      return;
    }
    await this.startAcceptedPrompt(agent, request);
  }

  async abortRun(input: {
    agentId?: string;
    runId?: string;
    reason?: string;
  }): Promise<void> {
    const agent = input.agentId ? this.requireAgent(input.agentId) : undefined;
    const conversationId =
      agent?.conversationId ?? this.findConversation(input.runId);
    if (!conversationId || !input.runId) {
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    const run = await this.deps.store.readTimelineRunControl(
      conversationId,
      input.runId,
    );
    if (!run)
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    const owner = agent ?? this.requireConversationAgent(conversationId);
    const result = await this.deps.termination.close({
      conversationId,
      runId: run.runId,
      agentId: owner.id,
      state: "cancelled",
      recoveryReason: input.reason,
      now: new Date().toISOString(),
    });
    if (result.kind === "rejected") {
      throw new ApplicationError(
        409,
        "RUN_CANCEL_REJECTED",
        result.outcome.kind,
      );
    }
  }

  abortAgent(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    return this.deps.store
      .readTimelineConversationHead(agent.conversationId)
      .then((head) =>
        head?.foregroundRunId
          ? this.abortRun({ agentId, runId: head.foregroundRunId })
          : undefined,
      );
  }

  async continueRun(agentId: string, runId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const run = await this.deps.store.readTimelineRunControl(
      agent.conversationId,
      runId,
    );
    if (!run)
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    this.deps.execution.wake();
  }

  continueAgent(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    return this.deps.store
      .readTimelineConversationHead(agent.conversationId)
      .then((head) =>
        head?.foregroundRunId
          ? this.continueRun(agentId, head.foregroundRunId)
          : undefined,
      );
  }

  async listQueuedPrompts(agentId: string): Promise<QueuedPromptRecord[]> {
    this.requireAgent(agentId);
    return (
      await this.deps.store.listDocuments<QueuedPromptRecord>(
        "canonical_prompt_queue",
        agentId,
      )
    )
      .map((document) => document.data)
      .filter(
        (prompt) => prompt.status === "queued" || prompt.status === "accepted",
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async cancelQueuedPrompt(
    agentId: string,
    promptId: string,
  ): Promise<QueuedPromptRecord> {
    const agent = this.requireAgent(agentId);
    const document = await this.deps.store.readDocument<QueuedPromptRecord>(
      "canonical_prompt_queue",
      agentId,
      promptId,
    );
    if (!document || document.data.status !== "queued") {
      throw new ApplicationError(
        404,
        "QUEUED_PROMPT_NOT_FOUND",
        "Queued prompt not found.",
      );
    }
    const head = await this.deps.store.readTimelineConversationHead(
      agent.conversationId,
    );
    if (!head) {
      throw new ApplicationError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
      );
    }
    const now = new Date().toISOString();
    const cancelled = {
      ...document.data,
      status: "cancelled" as const,
      updatedAt: now,
    };
    await this.commitPromptDocument({
      agent,
      head,
      commandId: `cancel-prompt:${promptId}`,
      operation: "cancel_queued_prompt",
      prompt: cancelled,
      expectedRevision: document.revision,
      now,
    });
    return cancelled;
  }

  async forcePushQueuedPrompts(agentId: string) {
    const queued = await this.listQueuedPrompts(agentId);
    return {
      accepted: true as const,
      runId: queued[0]?.runId ?? createId("run"),
      queuedPromptIds: queued.map((prompt) => prompt.id),
    };
  }

  async getContextUsage(conversationId: string): Promise<ContextUsage> {
    void conversationId;
    return { tokens: null, contextWindow: 0, percent: null };
  }

  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; parentRunId?: string },
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    return this.deps.mechanics.runExplore(parent, args, options);
  }

  async acceptNextQueuedPrompt(conversationId: string): Promise<boolean> {
    const agent = this.requireConversationAgent(conversationId);
    const documents = await this.deps.store.listDocuments<QueuedPromptRecord>(
      "canonical_prompt_queue",
      agent.id,
    );
    const next = documents
      .filter((document) => document.data.status === "queued")
      .sort((left, right) =>
        left.data.createdAt.localeCompare(right.data.createdAt),
      )[0];
    if (!next) return false;
    await this.startAcceptedPrompt(
      agent,
      { text: next.data.text, images: next.data.images },
      { record: next.data, expectedRevision: next.revision },
    );
    return true;
  }

  private async startAcceptedPrompt(
    agent: AgentRecord,
    request: Pick<PromptRequest, "text" | "images">,
    queuedPrompt?: { record: QueuedPromptRecord; expectedRevision: number },
  ): Promise<void> {
    const customModels = await this.deps.mechanics.customModels(
      agent.projectDir,
    );
    const model = (await import("@nervekit/harness/models")).resolveAgentModel(
      agent.model,
      customModels,
    );
    const result = await this.deps.starts.start({
      conversationId: agent.conversationId,
      runId: createId("run"),
      agentId: agent.id,
      prompt: request.text,
      images: request.images,
      providerIdentity: { provider: model.provider, model: model.id },
      providerCapability: "stateless_generation",
      queuedPrompt,
      now: new Date().toISOString(),
    });
    if (result.kind === "rejected") {
      throw new ApplicationError(
        409,
        "RUN_START_REJECTED",
        `Canonical run start rejected: ${result.outcome.kind}.`,
      );
    }
    this.deps.execution.wake();
  }

  private async enqueuePrompt(
    agent: AgentRecord,
    head: import("@nervekit/contracts/conversations").ConversationHead,
    request: PromptRequest,
  ): Promise<void> {
    const now = new Date().toISOString();
    const prompt: QueuedPromptRecord = {
      id: createId("promptq"),
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      runId: head.foregroundRunId ?? undefined,
      behavior: request.behavior === "follow-up" ? "follow-up" : "steer",
      text: request.text,
      images: request.images,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    await this.commitPromptDocument({
      agent,
      head,
      commandId: `enqueue-prompt:${prompt.id}`,
      operation: "enqueue_prompt",
      prompt,
      expectedRevision: 0,
      now,
    });
  }

  private async commitPromptDocument(input: {
    agent: AgentRecord;
    head: import("@nervekit/contracts/conversations").ConversationHead;
    commandId: string;
    operation: string;
    prompt: QueuedPromptRecord;
    expectedRevision: number;
    now: string;
  }): Promise<void> {
    const identity = await this.identity.resolve();
    const fingerprint = conversationCommandFingerprint({
      operation: input.operation,
      prompt: input.prompt,
    });
    const outcome = await this.transitions.commit({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: input.operation,
      ownerKind: "conversation",
      ownerId: input.agent.conversationId,
      commandId: input.commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [
        {
          conversationId: input.agent.conversationId,
          revision: input.head.revision,
          selectionEpoch: input.head.selectionEpoch,
        },
      ],
      transitions: [],
      domainDocuments: [
        {
          namespace: "canonical_prompt_queue",
          scopeId: input.agent.id,
          documentId: input.prompt.id,
          expectedRevision: input.expectedRevision,
          payloadVersion: 1,
          data: input.prompt,
        },
      ],
      outcome: input.prompt,
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      throw new ApplicationError(
        409,
        "PROMPT_QUEUE_CONFLICT",
        `Canonical prompt queue rejected: ${outcome.kind}.`,
      );
    }
  }

  private findConversation(runId?: string): string | undefined {
    if (!runId) return undefined;
    return [...this.deps.state.conversations.keys()].find((conversationId) =>
      runId.includes(conversationId.slice("conv_".length)),
    );
  }

  private requireConversationAgent(conversationId: string): AgentRecord {
    const agent = [...this.deps.state.agents.values()].find(
      (candidate) =>
        candidate.conversationId === conversationId && !candidate.parentAgentId,
    );
    if (!agent)
      throw new ApplicationError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }

  private requireAgent(agentId: string): AgentRecord {
    const agent = this.deps.state.agents.get(agentId);
    if (!agent)
      throw new ApplicationError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }
}
