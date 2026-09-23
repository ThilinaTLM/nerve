import type { AgentRecord, PromptRequest } from "@nervekit/contracts/agents";
import type { ContextUsage } from "@nervekit/contracts/models";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type { RunInteractionRecord } from "@nervekit/contracts/runs";
import type {
  ToolCallTranscriptRecord,
  ToolName,
} from "@nervekit/contracts/tools";
import { parseInlineCommandPrompt } from "@nervekit/contracts/completions";
import {
  ApprovalCheckpointConflictError,
  RunConflictError,
  TERMINAL_STATUSES,
  type ApprovalDecisionCommand,
  type ApprovalDecisionOutcome,
  type RunCoordinator,
  type RunHydratedState,
} from "../runtime/index.js";
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
  stopTeam?(leadId: string): Promise<void>;
  reopenTeam?(leadId: string): Promise<void>;
  wakeChild?(childId: string): Promise<void>;
  activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]>;
  getContextUsage(conversationId: string): Promise<ContextUsage>;
  getConversationEntries(conversationId: string): Promise<ConversationEntry[]>;
  resolveRecoveryIssuesForRun?(runId: string): Promise<unknown>;
  /**
   * Explicit recovery for a released approval checkpoint blocked by an
   * unproven tool outcome: settles it without executing anything again.
   */
  resolveBlockedApprovalCheckpoint?(runId: string): Promise<void>;
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

  /**
   * Active runs holding an approval checkpoint: awaiting decisions or
   * executing released tools. Used by checkpoint reconciliation.
   */
  async listApprovalCheckpointRuns(
    conversationId?: string,
  ): Promise<RunHydratedState[]> {
    const states = await this.unitOfWork.listActive();
    return states.filter(
      (state) =>
        (!conversationId || state.run.conversationId === conversationId) &&
        (state.run.status === "executing_tools" ||
          (state.run.status === "waiting" &&
            state.interactions.some(
              (interaction) =>
                interaction.kind === "approval" &&
                interaction.status === "pending",
            ))),
    );
  }

  /** A fresh durable read of one run, taken through the run repository lock. */
  async loadRunState(runId: string): Promise<RunHydratedState | undefined> {
    return this.unitOfWork.loadFresh(runId);
  }

  /** Records one approval decision; stale branches fail before persistence. */
  async recordApprovalDecision(
    runId: string,
    command: Omit<ApprovalDecisionCommand, "assertContext">,
  ): Promise<ApprovalDecisionOutcome> {
    try {
      return await this.coordinator.recordApprovalDecision(runId, {
        ...command,
        assertContext: (state) =>
          this.assertCheckpointOnActiveBranch(
            state,
            state.run.lastCheckpointId,
          ),
      });
    } catch (error) {
      if (error instanceof ApprovalCheckpointConflictError) {
        throw new ApplicationError(409, error.code, error.message);
      }
      throw error;
    }
  }

  settleApprovalCheckpoint(
    runId: string,
    checkpointId: string,
    accompanying: {
      entries: readonly ConversationEntry[];
      toolCalls: readonly ToolCallTranscriptRecord[];
    },
  ): Promise<boolean> {
    return this.coordinator.settleApprovalCheckpoint(runId, checkpointId, {
      entries: [...accompanying.entries],
      toolCalls: [...accompanying.toolCalls],
    });
  }

  /**
   * Cancels a run whose approval checkpoint became stale. A waiting checkpoint
   * is cancelled only while its interactions are still pending; a released
   * checkpoint cancels the run, which terminates undispatched tools.
   */
  async cancelStaleApprovalCheckpoint(
    state: RunHydratedState,
    reason: string,
  ): Promise<void> {
    const checkpointId = state.run.lastCheckpointId;
    if (state.run.status === "waiting" && checkpointId) {
      await this.coordinator.cancelWaitingCheckpoint({
        runId: state.run.runId,
        checkpointId,
        interactionIds: state.interactions
          .filter(
            (interaction) =>
              interaction.checkpointId === checkpointId &&
              interaction.status === "pending",
          )
          .map((interaction) => interaction.id),
        reason,
      });
      return;
    }
    if (state.run.status === "executing_tools") {
      await this.coordinator.cancel(state.run.runId, reason);
    }
  }

  /** Throws RUN_CHECKPOINT_STALE unless the checkpoint still owns the active branch tip. */
  async assertCheckpointOnActiveBranch(
    state: RunHydratedState,
    checkpointId: string | undefined,
  ): Promise<void> {
    const checkpoint = state.checkpoints.find(
      (candidate) => candidate.checkpointId === checkpointId,
    );
    if (!checkpoint) {
      throw new ApplicationError(
        409,
        "RUN_CHECKPOINT_STALE",
        "The approval checkpoint is no longer active.",
      );
    }
    const conversation = this.state.getConversation(state.run.conversationId);
    const currentEntryIds = activeBranchEntryIds(
      await this.features.getConversationEntries(conversation.id),
      conversation.activeEntryId,
    );
    if (!activeBranchEndsWithCheckpoint(currentEntryIds, checkpoint.entryIds)) {
      throw new ApplicationError(
        409,
        "RUN_CHECKPOINT_STALE",
        "The conversation changed after this approval was requested. No tool was executed.",
      );
    }
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
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
    if (agent.parentAgentId) {
      throw new ApplicationError(
        409,
        "SUBAGENT_NOT_INTERACTIVE",
        "Sub-agents are managed by their parent run and cannot receive direct prompts.",
      );
    }
    await this.features.reopenTeam?.(agent.id);
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
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
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
    await this.coordinator.scheduleContinuation(state.run.runId);
  }

  /**
   * Runs harness input that was appended outside a live execution. Terminal
   * runs are immutable, so an idle agent receives a fresh continuation run.
   */
  async wakeAgentFromHarness(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.executionKind === "async_developer") {
      await this.features.wakeChild?.(agentId);
      return;
    }
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
    const scopeId = this.scopeId(agent);
    const active = await this.unitOfWork.findActive(scopeId);
    if (active) {
      if (
        active.run.status === "suspended" ||
        active.run.status === "interrupted"
      ) {
        await this.coordinator.scheduleContinuation(active.run.runId);
      }
      return;
    }
    try {
      await this.coordinator.startContinuation({
        conversationId: agent.conversationId,
        agentId: agent.id,
        projectId: agent.projectId,
        scopeId,
      });
    } catch (error) {
      if (
        error instanceof RunConflictError &&
        (await this.unitOfWork.findActive(scopeId))
      ) {
        return;
      }
      throw error;
    }
  }

  async continueRun(agentId: string, runId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.load(runId);
    if (!state || state.run.agentId !== agent.id) {
      throw new ApplicationError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
    if (state.run.status === "executing_tools") {
      if (!this.features.resolveBlockedApprovalCheckpoint) {
        throw new ApplicationError(
          409,
          "RUN_EXECUTING_TOOLS",
          "Approved tools are still executing.",
        );
      }
      await this.features.resolveBlockedApprovalCheckpoint(runId);
    } else {
      await this.coordinator.scheduleContinuation(runId);
    }
    await this.features.resolveRecoveryIssuesForRun?.(runId);
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
    const owner =
      agent ?? (state ? this.requireAgent(state.run.agentId) : undefined);
    if (owner && !owner.parentAgentId) await this.features.stopTeam?.(owner.id);
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
    await this.features.resolveRecoveryIssuesForRun?.(state.run.runId);
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
    const existingEntryIds = new Set(
      state.transitions.flatMap((transition) =>
        transition.entries.map((entry) => entry.id),
      ),
    );
    const entries = (input.entries ?? []).filter(
      (entry) => !existingEntryIds.has(entry.id),
    );
    const command = {
      interactionId: interaction.id,
      resolutionRequestId: input.resolutionRequestId,
      resolution: input.resolution,
    };
    if (input.completeRun) {
      await this.coordinator.resolveAndCompleteInteraction(
        state.run.runId,
        command,
        {},
        { entries, toolCalls: [...(input.toolCalls ?? [])] },
      );
      return;
    }
    await this.coordinator.resolveInteraction(state.run.runId, command, {
      entries,
      toolCalls: [...(input.toolCalls ?? [])],
    });
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

// Checkpoints contain entries committed through the run transition journal.
// Other durable paths can append entries to the same model transcript between
// those transitions (for example, a completed tool result). The checkpoint
// must therefore be an ordered subsequence of the active branch and still own
// its tip; requiring a contiguous suffix incorrectly marks those runs stale.
export function activeBranchEndsWithCheckpoint(
  activeBranchEntryIds: readonly string[],
  checkpointEntryIds: readonly string[],
): boolean {
  if (checkpointEntryIds.length === 0 || activeBranchEntryIds.length === 0)
    return false;
  if (checkpointEntryIds.at(-1) !== activeBranchEntryIds.at(-1)) return false;

  let checkpointIndex = 0;
  for (const entryId of activeBranchEntryIds) {
    if (entryId === checkpointEntryIds[checkpointIndex]) checkpointIndex += 1;
  }
  return checkpointIndex === checkpointEntryIds.length;
}

function activeBranchEntryIds(
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
