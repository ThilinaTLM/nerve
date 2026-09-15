import { createId } from "@nervekit/contracts";
import { createHash } from "node:crypto";
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
import type { ExploreReport } from "../../agents/execution/canonical-explore-coordinator.js";

export interface CanonicalExecutionWake {
  wake(): void;
  abortRun?(runId: string, reason?: string): void;
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

  async reconcileConversation(conversationId: string, requestId: string) {
    const operationId = `reconcile_${createHash("sha256")
      .update(`${conversationId}:${requestId}`)
      .digest("hex")}`;
    const existing = await this.deps.store.readDocument<
      Record<string, unknown>
    >("canonical_reconciliation", conversationId, operationId);
    if (existing) return existing.data;
    const recovered =
      await this.deps.store.execution.recoverExpiredLifecycleWork({
        now: new Date().toISOString(),
        limit: 256,
      });
    const relevant = [
      ...recovered.filter((work) => work.conversationId === conversationId),
      ...(await this.deps.store.execution.listRecoveryWork(conversationId)),
    ].filter(
      (work, index, all) =>
        all.findIndex((candidate) => candidate.workId === work.workId) ===
        index,
    );
    const head =
      await this.deps.store.readTimelineConversationHead(conversationId);
    if (!head)
      throw new ApplicationError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
      );
    for (const runId of new Set(relevant.map((work) => work.runId))) {
      const run = await this.deps.store.readTimelineRunControl(
        conversationId,
        runId,
      );
      if (run?.foregroundOwned) {
        const agent = this.requireConversationAgent(conversationId);
        await this.deps.termination.close({
          conversationId,
          runId,
          agentId: agent.id,
          projectId: agent.projectId,
          state: "abandoned",
          recoveryReason: "unknown_external_outcome",
          now: new Date().toISOString(),
        });
      }
    }
    const result = {
      operationId,
      status: "completed" as const,
      changed: relevant.length > 0,
      observedRevision: head.revision,
      preservedInputs: 0,
      repairedTransitions: 0,
      requeuedWork: relevant.filter((work) => work.state === "ready").length,
      unknownOutcomes: relevant.filter(
        (work) => work.state === "recovery_required",
      ).length,
      recoveryIssues: [],
    };
    try {
      await this.deps.store.writeDocument({
        namespace: "canonical_reconciliation",
        scopeId: conversationId,
        documentId: operationId,
        data: result,
        expectedRevision: 0,
        now: new Date().toISOString(),
      });
    } catch {
      const winner = await this.deps.store.readDocument<typeof result>(
        "canonical_reconciliation",
        conversationId,
        operationId,
      );
      if (winner) return winner.data;
      throw new Error(
        "Canonical reconciliation result could not be persisted.",
      );
    }
    this.deps.execution.wake();
    return result;
  }

  async activeForConversation(conversationId: string) {
    const head =
      await this.deps.store.readTimelineConversationHead(conversationId);
    if (!head?.foregroundRunId) return undefined;
    const run = await this.deps.store.readTimelineRunControl(
      conversationId,
      head.foregroundRunId,
    );
    if (!run || !run.foregroundOwned) return undefined;
    const agent = this.requireConversationAgent(conversationId);
    const conversation = this.deps.state.getConversation(conversationId);
    return {
      runId: run.runId,
      agentId: agent.id,
      projectId: agent.projectId,
      conversationId,
      status:
        run.state === "waiting" || run.state === "partially_waiting"
          ? ("waiting" as const)
          : ("running" as const),
      startedAt: conversation.updatedAt,
      turns: [],
      toolOutputsByToolCallId: {},
      queuedPrompts: await this.listQueuedPrompts(agent.id),
    };
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
      agent?.conversationId ?? (await this.findConversation(input.runId));
    if (!conversationId) {
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    const runId =
      input.runId ??
      (await this.deps.store.readTimelineConversationHead(conversationId))
        ?.foregroundRunId;
    if (!runId) {
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    const run = await this.deps.store.readTimelineRunControl(
      conversationId,
      runId,
    );
    if (!run)
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    const owner = agent ?? this.requireConversationAgent(conversationId);
    const result = await this.deps.termination.close({
      conversationId,
      runId: run.runId,
      agentId: owner.id,
      projectId: owner.projectId,
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
    this.deps.execution.abortRun?.(runId, input.reason ?? "run_cancelled");
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
    const agent = this.requireAgent(agentId);
    return (
      await this.deps.store.listDocuments<QueuedPromptRecord>(
        "canonical_prompt_queue",
        agent.conversationId,
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
      agent.conversationId,
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
    options?: {
      signal?: AbortSignal;
      parentRunId?: string;
      parentToolCallId?: string;
    },
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    return this.deps.mechanics.runExplore(parent, args, options);
  }

  async runManagedAgent(input: {
    agent: AgentRecord;
    prompt: string;
    runId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    await this.startAcceptedPrompt(
      input.agent,
      { text: input.prompt },
      undefined,
      input.runId,
    );
    for (;;) {
      if (input.signal?.aborted) {
        await this.abortRun({ runId: input.runId, reason: "cancelled" });
        throw input.signal.reason ?? new Error("Managed run was cancelled.");
      }
      const head = await this.deps.store.readTimelineConversationHead(
        input.agent.conversationId,
      );
      if (!head?.foregroundRunId) {
        const run = await this.deps.store.readTimelineRunControl(
          input.agent.conversationId,
          input.runId,
        );
        if (run?.state !== "completed") {
          throw new Error(
            run?.recoveryReason ??
              `Managed run stopped in state ${run?.state ?? "missing"}.`,
          );
        }
        if (!head?.activeEntryId) return "";
        const ancestry = await this.deps.store.readTimelineAncestrySegment(
          input.agent.conversationId,
          head.activeEntryId,
          512,
        );
        const assistant = ancestry.entries.find(
          (entry) => entry.kind === "assistant_message",
        );
        const inline = assistant?.inlineContent as
          | { text?: unknown }
          | undefined;
        return typeof inline?.text === "string" ? inline.text : "";
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async acceptNextQueuedPrompt(conversationId: string): Promise<boolean> {
    const agent = this.requireConversationAgent(conversationId);
    const documents = await this.deps.store.listDocuments<QueuedPromptRecord>(
      "canonical_prompt_queue",
      agent.conversationId,
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
    explicitRunId?: string,
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
      runId: explicitRunId ?? createId("run"),
      agentId: agent.id,
      projectId: agent.projectId,
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
          scopeId: input.agent.conversationId,
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

  private async findConversation(runId?: string): Promise<string | undefined> {
    if (!runId) return undefined;
    for (const conversationId of this.deps.state.conversations.keys()) {
      if (await this.deps.store.readTimelineRunControl(conversationId, runId)) {
        return conversationId;
      }
    }
    return undefined;
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
