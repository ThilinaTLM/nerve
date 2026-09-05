import type { AgentRecord, PromptRequest } from "@nervekit/contracts/agents";
import type { ContextUsage } from "@nervekit/contracts/models";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { RunInteractionRecord } from "@nervekit/contracts/runs";
import type {
  ToolCallTranscriptRecord,
  ToolName,
} from "@nervekit/contracts/tools";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import { TERMINAL_STATUSES, type RunCoordinator } from "../runtime/index.js";
import { ApplicationError } from "../../../core/application-error.js";
import type { RuntimeState } from "../../../app/runtime/runtime-projections.js";
import type { ExploreReport } from "../../agents/execution/subagent-runner.js";
import type { WorkbenchRunUnitOfWork } from "../persistence/run-transition.repository.js";

export interface ApprovalInteractionBatch {
  runId: string;
  checkpointId: string;
  batchToolCallIds: readonly string[];
  interactions: readonly RunInteractionRecord[];
}

export interface WorkbenchRunFeatureMechanics {
  activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]>;
  getContextUsage(conversationId: string): Promise<ContextUsage>;
  getConversationEntries(conversationId: string): Promise<ConversationEntry[]>;
  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; parentRunId?: string },
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }>;
}

/**
 * Operation-facing facade. It is intentionally thin: scope resolution and
 * public busy semantics live here; every lifecycle transition is delegated to
 * the shared RunCoordinator.
 */
export class WorkbenchRunService {
  constructor(
    private readonly state: RuntimeState,
    private readonly coordinator: RunCoordinator,
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
    private readonly features: WorkbenchRunFeatureMechanics,
  ) {}

  async observeApprovalCommit(runId: string): Promise<void> {
    await this.unitOfWork.loadFresh(runId);
    await this.coordinator.observeAggregateCommit(runId);
  }

  async continueApprovalSettlement(
    settlement: import("@nervekit/contracts/conversations").ApprovalSettlement,
  ): Promise<void> {
    if (!settlement.runId) return;
    await this.unitOfWork.loadFresh(settlement.runId);
    await this.coordinator.continue(settlement.runId, settlement);
  }

  async listApprovalRecoveryInteractions(): Promise<RunInteractionRecord[]> {
    const states = await this.unitOfWork.listActive();
    return states.flatMap((state) =>
      ["waiting", "suspended", "settling"].includes(state.run.status)
        ? state.interactions.filter(
            (item) =>
              item.kind === "approval" &&
              item.checkpointId === state.run.lastCheckpointId,
          )
        : [],
    );
  }

  async listPendingApprovalInteractions(
    conversationId?: string,
  ): Promise<RunInteractionRecord[]> {
    const states = await this.unitOfWork.listActive();
    return states.flatMap((state) =>
      state.run.status === "waiting" &&
      (!conversationId || state.run.conversationId === conversationId)
        ? state.interactions.filter(
            (interaction) =>
              interaction.kind === "approval" &&
              interaction.status === "pending",
          )
        : [],
    );
  }

  async listQueuedPrompts(agentId: string) {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.findActive(this.scopeId(agent));
    if (!state) return [];
    return state.prompts
      .filter(
        (prompt) =>
          prompt.agentId === agentId &&
          (prompt.status === "queued" || prompt.status === "accepted"),
      )
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  async cancelQueuedPrompt(agentId: string, promptId: string) {
    this.requireAgent(agentId);
    const state = await this.unitOfWork.findByPromptId(promptId);
    const prompt = state?.prompts.find(
      (candidate) => candidate.id === promptId && candidate.agentId === agentId,
    );
    if (!state || !prompt) {
      throw new ApplicationError(
        404,
        "QUEUED_PROMPT_NOT_FOUND",
        "Queued prompt not found.",
      );
    }
    return this.coordinator.cancelPrompt(state.run.runId, promptId);
  }

  async forcePushQueuedPrompts(agentId: string) {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.findActive(this.scopeId(agent));
    if (!state) {
      throw new ApplicationError(
        409,
        "AGENT_NOT_RUNNING",
        "Agent has no active run.",
      );
    }
    const prompts = await this.coordinator.forcePush(state.run.runId);
    return {
      accepted: true as const,
      runId: state.run.runId,
      queuedPromptIds: prompts.map((prompt) => prompt.id),
    };
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.parentAgentId) {
      throw new ApplicationError(
        409,
        "SUBAGENT_NOT_INTERACTIVE",
        "Sub-agents are managed by their parent run and cannot receive direct prompts.",
      );
    }
    const scopeId = this.scopeId(agent);
    const active = await this.unitOfWork.findActive(scopeId);
    if (active) {
      if (parseInlineCommandPrompt(request.text)) {
        throw new ApplicationError(
          409,
          "AGENT_BUSY",
          "Agent is already running.",
        );
      }
      const behavior = request.behavior ?? "steer";
      if (behavior === "reject-if-busy") {
        throw new ApplicationError(
          409,
          "AGENT_BUSY",
          "Agent is already running.",
        );
      }
      if (behavior === "follow-up") {
        await this.coordinator.followUp(
          active.run.runId,
          request.text,
          request.images,
        );
      } else {
        await this.coordinator.steer(
          active.run.runId,
          request.text,
          request.images,
        );
      }
      return;
    }
    await this.coordinator.start({
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      scopeId,
      prompt: request.text,
      images: request.images,
    });
  }

  async continueAgent(agentId: string): Promise<void> {
    const state = await this.requireCurrentRun(agentId);
    await this.coordinator.continue(state.run.runId);
  }

  async continueRun(agentId: string, runId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.load(runId);
    if (!state || state.run.agentId !== agent.id) {
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    await this.coordinator.continue(runId);
  }

  async abortRun(input: {
    agentId?: string;
    runId?: string;
    reason?: string;
  }): Promise<void> {
    const agent = input.agentId ? this.requireAgent(input.agentId) : undefined;
    const state = input.runId
      ? await this.unitOfWork.load(input.runId)
      : agent
        ? await this.unitOfWork.findActive(this.scopeId(agent))
        : undefined;
    if (!state) {
      if (input.runId) {
        throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
      }
      return;
    }
    if (agent && state.run.agentId !== agent.id) {
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    await this.coordinator.cancel(
      state.run.runId,
      input.reason ?? "user requested abort",
    );
  }

  async abortAgent(agentId: string): Promise<void> {
    await this.abortRun({ agentId });
  }

  async interactionResolutionStateForToolCall(
    toolCallId: string,
    runId: string,
  ): Promise<"pending" | "terminal"> {
    const state = await this.unitOfWork.load(runId);
    if (!state) {
      throw new ApplicationError(
        409,
        "RUN_NOT_FOUND",
        "The source run was not found.",
      );
    }
    const interaction = state.interactions.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    if (TERMINAL_STATUSES.has(state.run.status)) return "terminal";
    if (interaction?.status === "pending") return "pending";
    throw new ApplicationError(
      409,
      "RUN_INTERACTION_NOT_PENDING",
      "The run interaction is not pending.",
    );
  }

  async assertPendingInteractionForToolCall(
    toolCallId: string,
    runId?: string,
  ): Promise<void> {
    // Prefer the known run ID; the interaction lookup covers callers that
    // only carry a tool-call ID.
    const state = runId
      ? await this.unitOfWork.loadFresh(runId)
      : await this.unitOfWork.findByInteractionToolCallId(toolCallId);
    const interaction = state?.interactions.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    if (
      !interaction ||
      interaction.status !== "pending" ||
      !(await this.unitOfWork.hasActionableInteraction(
        interaction.runId,
        toolCallId,
      ))
    ) {
      throw new ApplicationError(
        409,
        "RUN_INTERACTION_NOT_PENDING",
        "The run interaction is not pending.",
      );
    }
  }

  async interactionBatchForToolCall(
    toolCallId: string,
    runId?: string,
  ): Promise<ApprovalInteractionBatch> {
    const state = runId
      ? await this.unitOfWork.loadFresh(runId)
      : await this.unitOfWork.findByInteractionToolCallId(toolCallId);
    const target = state?.interactions.find(
      (interaction) => interaction.toolCallId === toolCallId,
    );
    if (
      !state ||
      !target ||
      state.run.status !== "waiting" ||
      target.status !== "pending" ||
      !(await this.unitOfWork.hasActionableInteraction(
        state.run.runId,
        toolCallId,
      ))
    ) {
      throw new ApplicationError(
        409,
        "RUN_INTERACTION_NOT_FOUND",
        "The pending run interaction was not found.",
      );
    }
    const batchToolCallIds = target.batchToolCallIds ?? [target.toolCallId];
    const interactions = batchToolCallIds.flatMap((memberToolCallId) => {
      const interaction = state.interactions.find(
        (candidate) =>
          candidate.checkpointId === target.checkpointId &&
          candidate.toolCallId === memberToolCallId,
      );
      return interaction ? [interaction] : [];
    });
    return {
      runId: state.run.runId,
      checkpointId: target.checkpointId,
      batchToolCallIds,
      interactions,
    };
  }

  async resolveInteractionForToolCall(input: {
    toolCallId: string;
    runId?: string;
    resolutionRequestId: string;
    resolution: Record<string, unknown>;
    entries?: readonly ConversationEntry[];
    toolCalls?: readonly ToolCallTranscriptRecord[];
    continueRun: boolean;
    completeRun?: boolean;
  }): Promise<void> {
    const state = input.runId
      ? await this.unitOfWork.load(input.runId)
      : await this.unitOfWork.findByInteractionToolCallId(input.toolCallId);
    const interaction = state?.interactions.find(
      (candidate) => candidate.toolCallId === input.toolCallId,
    );
    if (!state || !interaction) {
      throw new ApplicationError(
        409,
        "RUN_INTERACTION_NOT_FOUND",
        "The pending run interaction was not found.",
      );
    }
    // Commit the resolved tool result and entries before resolving the
    // interaction. Checkpoint validation for a resolved interaction accepts a
    // forward-only transcript (see run-checkpoints), so the continue below
    // resumes from the suspension checkpoint idempotently.
    if (input.toolCalls?.length) {
      await this.coordinator.upsertToolCalls(state.run.runId, input.toolCalls);
    }
    if (input.entries?.length) {
      await this.coordinator.appendEntries(state.run.runId, input.entries);
    }
    const command = {
      interactionId: interaction.id,
      resolutionRequestId: input.resolutionRequestId,
      resolution: input.resolution,
    };
    if (input.completeRun) {
      await this.coordinator.resolveAndCompleteInteraction(
        state.run.runId,
        command,
      );
      return;
    }
    const resolved = await this.coordinator.resolveInteraction(
      state.run.runId,
      command,
    );
    if (input.continueRun) {
      const settlement = await this.unitOfWork.approvalSettlementForRun(
        state.run.runId,
      );
      if (settlement && !["completed", "cancelled"].includes(settlement.phase))
        return;
      const latest = await this.unitOfWork.load(state.run.runId);
      const hasPendingSibling = latest?.interactions.some(
        (candidate) =>
          candidate.id !== resolved.id &&
          candidate.checkpointId === resolved.checkpointId &&
          candidate.status === "pending",
      );
      if (!hasPendingSibling) await this.coordinator.continue(state.run.runId);
    }
  }

  getContextUsage(conversationId: string): Promise<ContextUsage> {
    return this.features.getContextUsage(conversationId);
  }

  activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]> {
    return this.features.activeToolNamesFor(agent);
  }

  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; parentRunId?: string },
  ): Promise<{
    reports: ExploreReport[];
    contentBlocks: [{ type: "text"; text: string }];
  }> {
    return this.features.runExplore(parent, args, options);
  }

  private async requireCurrentRun(agentId: string) {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.findActive(this.scopeId(agent));
    if (!state) {
      throw new ApplicationError(
        409,
        "AGENT_NOT_RUNNING",
        "Agent is not running.",
      );
    }
    return state;
  }

  private requireAgent(agentId: string): AgentRecord {
    const agent = this.state.agents.get(agentId);
    if (!agent)
      throw new ApplicationError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }

  private scopeId(agent: AgentRecord): string {
    return `${agent.conversationId}:${agent.id}`;
  }
}

// Checkpoints contain this run's transcript, while the active branch also
// contains entries from earlier runs. The run transcript must remain its tail.
export function activeBranchEndsWithCheckpoint(
  activeBranchEntryIds: readonly string[],
  checkpointEntryIds: readonly string[],
): boolean {
  if (checkpointEntryIds.length > activeBranchEntryIds.length) return false;
  const offset = activeBranchEntryIds.length - checkpointEntryIds.length;
  return checkpointEntryIds.every(
    (entryId, index) => activeBranchEntryIds[offset + index] === entryId,
  );
}

export function activeBranchEntryIds(
  entries: readonly ConversationEntry[],
  activeEntryId: string | undefined,
): string[] {
  if (!activeEntryId) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ids: string[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined = activeEntryId;
  while (cursor) {
    if (visited.has(cursor)) return [];
    visited.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) return [];
    ids.push(entry.id);
    cursor = entry.parentEntryId;
  }
  return ids.reverse();
}
