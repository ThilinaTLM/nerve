import { forcePushAgentInputs } from "./workbench-agent-force-push.js";
import { waitForRun } from "./workbench-agent-run-results.js";
import { assertApprovalCheckpointBranch } from "./approval-checkpoint-branch.js";
export { activeBranchEndsWithCheckpointResults } from "./approval-checkpoint-branch.js";
import { randomUUID } from "node:crypto";
import { WorkbenchAgentInputControls } from "./workbench-agent-input-controls.js";
import {
  AgentInputConflictError,
  type AgentInputRequest,
  type AgentInputService,
} from "../runtime/agent-inputs.js";
import { resolveCompactionOwner } from "../../conversations/compaction-owner.js";
import type {
  AgentRecord,
  AgentInputRecord,
  AgentCompletion,
  PromptRequest,
} from "@nervekit/contracts/agents";
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
  canInterruptTurn?(agent: AgentRecord, runId: string): Promise<boolean>;
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
export interface WorkbenchAgentControls {
  inputs: AgentInputService;
  inputAccepted?(input: AgentInputRecord): Promise<void>;
  admissionPolicy?: {
    recordAdministrativeActivation?(input: {
      agentId: string;
      generation: number;
      cause: "user_resume" | "user_interrupt";
      runId?: string;
    }): Promise<void>;
    reserve(input: {
      agentId: string;
      runId: string;
      inputs: readonly AgentInputRecord[];
    }): Promise<void>;
    committed(input: { agentId: string; runId: string }): Promise<void>;
    released(input: { agentId: string; runId: string }): Promise<void>;
  };
  setActivationState?(
    agentId: string,
    state: "enabled" | "paused",
  ): Promise<void>;
  getCompletion?(
    agentId: string,
    runId: string,
    submittedAttemptId?: string,
  ): Promise<AgentCompletion>;
  getAgentHistory?(agentId: string): Promise<ConversationEntry[]>;
  getAgentActiveEntryId?(agentId: string): Promise<string | null>;
  hasAgentContextEntry?(agentId: string, entryId: string): Promise<boolean>;
}

export class WorkbenchRunService {
  private readonly inputControls: WorkbenchAgentInputControls;
  constructor(
    private readonly state: RuntimeState,
    private readonly coordinator: RunCoordinator,
    private readonly unitOfWork: WorkbenchRunUnitOfWork,
    private readonly features: WorkbenchRunFeatureMechanics,
    private readonly controls?: WorkbenchAgentControls,
  ) {
    this.inputControls = new WorkbenchAgentInputControls(
      state,
      coordinator,
      unitOfWork,
      features,
      controls,
      this,
    );
  }

  /** Fence automatic admission without changing durable agent activation. */
  stopAdmissions = () => this.inputControls.stopAdmissions();
  settledInputWork = () => this.inputControls.settledInputWork();
  withAgentAdmission = <T>(agentId: string, action: () => Promise<T>) =>
    this.inputControls.withAdmission(agentId, action);
  enqueueAgentInput = (agentId: string, request: AgentInputRequest) =>
    this.inputControls.withInputWork(() =>
      this.inputControls.enqueueAgentInput(agentId, request),
    );
  submitAgentRun = (
    agentId: string,
    text: string,
    parent?: { agentId: string; runId?: string },
    options?: { signal?: AbortSignal; idempotencyKey?: string },
  ) =>
    this.inputControls.withInputWork(() =>
      this.inputControls.submitAgentRun(agentId, text, parent, options),
    );
  waitForAgentRun = (
    identity: { agentId: string; runId: string; attemptId: string },
    signal?: AbortSignal,
  ) => this.inputControls.waitForAgentRun(identity, signal);
  waitForRun(runId: string, signal?: AbortSignal, unref = false) {
    return waitForRun(this.unitOfWork, runId, signal, unref);
  }

  async getAgentHistory(agentId: string): Promise<ConversationEntry[]> {
    const agent = this.requireAgent(agentId);
    if (this.controls?.getAgentHistory)
      return this.controls.getAgentHistory(agentId);
    return (
      await this.features.getConversationEntries(agent.conversationId)
    ).filter((entry) => entry.agentId === agentId);
  }
  resumeAgent = (
    agentId: string,
    onResumed?: (generation: number) => void,
    options?: { authority: "user_administration" },
  ) => this.inputControls.resumeAgent(agentId, onResumed, options);
  interruptAgent = (
    agentId: string,
    request: PromptRequest,
    options?: {
      authority?: "user_administration";
      parent?: { agentId: string; runId?: string };
    },
  ) => this.inputControls.interruptAgent(agentId, request, options);

  /**
   * Active runs holding an approval checkpoint: awaiting decisions or
   * executing released tools. Used by checkpoint reconciliation.
   */
  settledAdmissions = () => this.inputControls.settledAdmissions();
  migrateLegacyInputs = () => this.inputControls.migrateLegacyInputs();

  recoverAgentInputs = (excludeAgentId?: string) =>
    this.inputControls.recoverAgentInputs(excludeAgentId);

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
    return this.coordinator.settleApprovalCheckpoint(
      runId,
      checkpointId,
      {
        entries: [...accompanying.entries],
        toolCalls: [...accompanying.toolCalls],
      },
      (state) => this.assertCheckpointOnActiveBranch(state, checkpointId),
    );
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
    const conversation = this.state.getConversation(state.run.conversationId);
    const agent = this.requireAgent(state.run.agentId);
    const owner = resolveCompactionOwner(conversation.id, agent);
    const entries =
      owner.ownerAgentId === undefined
        ? await this.features.getConversationEntries(conversation.id)
        : await this.getAgentHistory(agent.id);
    const activeEntryId =
      owner.ownerAgentId === undefined
        ? conversation.activeEntryId
        : ((await this.controls?.getAgentActiveEntryId?.(agent.id)) ??
          entries.at(-1)?.id);
    assertApprovalCheckpointBranch(state, checkpointId, entries, activeEntryId);
  }

  async hasNonterminalOwnerRun(
    conversationId: string,
    ownerAgentId?: string,
  ): Promise<boolean> {
    for (const agent of this.state.agents.values()) {
      if (
        agent.conversationId !== conversationId ||
        resolveCompactionOwner(conversationId, agent).ownerAgentId !==
          ownerAgentId
      )
        continue;
      if (await this.unitOfWork.findActive(this.scopeId(agent))) return true;
    }
    return false;
  }

  async listQueuedPrompts(agentId: string) {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.findActive(this.scopeId(agent));
    if (this.controls) return this.controls.inputs.list(agentId);
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
    const migrated = (await this.controls?.inputs.list(agentId))?.find(
      (input) => input.idempotencyKey === `legacy:${promptId}`,
    );
    if (this.controls && (promptId.startsWith("input_") || migrated)) {
      try {
        return await this.controls.inputs.cancel(
          agentId,
          migrated?.id ?? promptId,
        );
      } catch (error) {
        if (error instanceof AgentInputConflictError)
          throw new ApplicationError(
            409,
            "INPUT_NOT_PENDING",
            "Input was cancelled or delivery has already begun.",
          );
        throw error;
      }
    }
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

  forcePushQueuedPrompts(agentId: string, requestId: string = randomUUID()) {
    const agent = this.requireAgent(agentId);
    return forcePushAgentInputs(
      {
        inputs: this.controls?.inputs,
        coordinator: this.coordinator,
        canInterrupt: this.features.canInterruptTurn?.bind(
          this.features,
          agent,
        ),
        findActive: () => this.unitOfWork.findActive(this.scopeId(agent)),
        withControl: (action) =>
          this.inputControls.withControl(agentId, action),
      },
      agentId,
      requestId,
    );
  }

  promptAgent(agentId: string, request: PromptRequest) {
    return this.inputControls.withInputWork(() =>
      this.performPromptAgent(agentId, request),
    );
  }
  private async performPromptAgent(
    agentId: string,
    request: PromptRequest,
  ): Promise<AgentInputRecord | undefined> {
    const agent = this.requireAgent(agentId);
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
    const previous =
      this.controls && request.idempotencyKey
        ? await this.controls.inputs.acceptanceForKey(
            agentId,
            request.idempotencyKey,
          )
        : undefined;
    if (
      !previous &&
      parseInlineCommandPrompt(request.text) &&
      (agent.readOnlyCeiling || agent.permissionLevel === "read_only")
    )
      throw new ApplicationError(
        403,
        "INLINE_COMMAND_FORBIDDEN",
        "Read-only agent policy forbids inline shell execution.",
      );
    if (this.controls) {
      const active = await this.unitOfWork.findActive(this.scopeId(agent));
      if (active && !previous && request.behavior === "reject-if-busy")
        throw new ApplicationError(
          409,
          "AGENT_BUSY",
          "Agent is already running.",
        );
      return await this.enqueueAgentInput(agentId, {
        text: request.text,
        images: request.images,
        role: "user",
        origin: { kind: "user", userId: "authorized-user" },
        idempotencyKey: request.idempotencyKey ?? randomUUID(),
        eligibility: parseInlineCommandPrompt(request.text)
          ? previous?.eligibility.kind === "next_run"
            ? previous.eligibility
            : { kind: "next_run", afterRunId: active?.run.runId }
          : { kind: "next_turn" },
        activation: "wake_if_idle",
      });
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
    if (this.controls) return this.resumeAgent(agentId);
    const state = await this.requireCurrentRun(agentId);
    await this.coordinator.scheduleContinuation(state.run.runId);
  }

  /**
   * Runs harness input that was appended outside a live execution. Terminal
   * runs are immutable, so an idle agent receives a fresh continuation run.
   */
  async wakeAgentFromHarness(agentId: string, explicit = false): Promise<void> {
    if (this.inputControls.admissionsStopped) return;
    await this.inputControls.withAdmission(agentId, () =>
      this.activateAgent(agentId, explicit),
    );
  }
  private async activateAgent(
    agentId: string,
    explicit: boolean,
  ): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (
      agent.activationState === "paused" ||
      (await this.controls?.inputs.isPaused(agentId))
    )
      return;
    this.state.maintenanceScopes.assertConversation(agent.conversationId);
    this.state.maintenanceScopes.assertProject(agent.projectId);
    const scopeId = this.scopeId(agent);
    const active = await this.unitOfWork.findActive(scopeId);
    // Automatic wakes never bypass a suspension or interrupted recovery fence.
    // Explicit resume and interaction resolution own those continuations.
    if (active) return;
    const blocker = await this.controls?.inputs.admissionBlocker(agentId);
    if (
      !explicit &&
      blocker?.configurationRevision === (agent.configurationRevision ?? 1)
    )
      return;
    if (
      this.controls &&
      !explicit &&
      !(await this.controls.inputs.hasWakeRequest(agentId)) &&
      !(await this.controls.inputs.hasContextPending(agentId)) &&
      !(await this.controls.inputs.list(agentId)).some(
        (input) =>
          input.activation === "wake_if_idle" &&
          input.eligibility.kind !== "run",
      )
    )
      return;
    try {
      await this.inputControls.admitAgentRun(
        agent,
        undefined,
        undefined,
        explicit,
      );
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
    onPaused?: (generation: number) => void;
  }): Promise<void> {
    await this.inputControls.abortRun(input);
  }

  async abortAgent(
    agentId: string,
    onPaused?: (generation: number) => void,
  ): Promise<void> {
    await this.abortRun({ agentId, onPaused });
  }

  async isToolInteractionResolved(
    toolCallId: string,
    runId: string,
  ): Promise<boolean> {
    const state = await this.unitOfWork.load(runId);
    return (
      state?.interactions.some(
        (item) => item.toolCallId === toolCallId && item.status !== "pending",
      ) ?? false
    );
  }

  async wakePlanImplementation(
    agentId: string,
    reviewId: string,
  ): Promise<void> {
    const agent = this.requireAgent(agentId);
    const runId = `run_plan_${reviewId}`;
    if (await this.unitOfWork.load(runId)) return;
    await this.coordinator.startContinuation({
      runId,
      conversationId: agent.conversationId,
      agentId,
      projectId: agent.projectId,
      scopeId: this.scopeId(agent),
    });
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
