import type {
  AgentRecord,
  ContextUsage,
  ConversationEntry,
  PromptRequest,
  RunInteractionRecord,
  ToolCallTranscriptRecord,
  ToolName,
} from "@nervekit/contracts";
import { parseInlineCommandPrompt } from "@nervekit/contracts";
import { TERMINAL_STATUSES, type RunCoordinator } from "@nervekit/host-runtime";
import { HttpError } from "../../http/errors.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ExploreReport } from "../agents/run/subagent-runner.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

export interface ApprovalInteractionBatch {
  runId: string;
  checkpointId: string;
  batchToolCallIds: readonly string[];
  interactions: readonly RunInteractionRecord[];
}

export interface ApprovalBatchResolutionMember {
  interaction: RunInteractionRecord;
  resolution: Record<string, unknown>;
}

export interface WorkbenchRunFeatureMechanics {
  activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]>;
  getContextUsage(conversationId: string): Promise<ContextUsage>;
  resetAutoContinuationCount(conversationId: string): void;
  runExplore(
    parent: AgentRecord,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
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
      throw new HttpError(
        404,
        "QUEUED_PROMPT_NOT_FOUND",
        "Queued prompt not found.",
      );
    }
    return this.coordinator.cancelPrompt(state.run.runId, promptId);
  }

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.requireAgent(agentId);
    const scopeId = this.scopeId(agent);
    const active = await this.unitOfWork.findActive(scopeId);
    if (active) {
      if (parseInlineCommandPrompt(request.text)) {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
      }
      const behavior = request.behavior ?? "steer";
      if (behavior === "reject-if-busy") {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
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
    this.features.resetAutoContinuationCount(agent.conversationId);
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
      throw new HttpError(404, "RUN_NOT_FOUND", "Run not found.");
    }
    await this.coordinator.continue(runId);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.findActive(this.scopeId(agent));
    if (!state) return;
    await this.coordinator.cancel(state.run.runId, "user requested abort");
  }

  async interactionResolutionStateForToolCall(
    toolCallId: string,
    runId: string,
  ): Promise<"pending" | "terminal"> {
    const state = await this.unitOfWork.load(runId);
    if (!state) {
      throw new HttpError(
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
    throw new HttpError(
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
      ? await this.unitOfWork.load(runId)
      : await this.unitOfWork.findByInteractionToolCallId(toolCallId);
    const interaction = state?.interactions.find(
      (candidate) => candidate.toolCallId === toolCallId,
    );
    if (!interaction || interaction.status !== "pending") {
      throw new HttpError(
        409,
        "RUN_INTERACTION_NOT_PENDING",
        "The run interaction is not pending.",
      );
    }
  }

  async approvalBatchForToolCall(
    toolCallId: string,
    runId?: string,
  ): Promise<ApprovalInteractionBatch> {
    const state = runId
      ? await this.unitOfWork.load(runId)
      : await this.unitOfWork.findByInteractionToolCallId(toolCallId);
    const target = state?.interactions.find(
      (interaction) => interaction.toolCallId === toolCallId,
    );
    if (
      !state ||
      !target ||
      state.run.status !== "waiting" ||
      target.status !== "pending"
    ) {
      throw new HttpError(
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
    if (
      interactions.some(
        (interaction) =>
          interaction.kind !== "approval" ||
          interaction.checkpointId !== target.checkpointId,
      )
    ) {
      throw new HttpError(
        409,
        "RUN_APPROVAL_BATCH_INVALID",
        "The run approval batch is invalid.",
      );
    }
    return {
      runId: state.run.runId,
      checkpointId: target.checkpointId,
      batchToolCallIds,
      interactions,
    };
  }

  async resolveInteractionBatchForToolCalls(input: {
    members: readonly ApprovalBatchResolutionMember[];
    entries: readonly ConversationEntry[];
    toolCalls: readonly ToolCallTranscriptRecord[];
    resolutionRequestId: string;
  }): Promise<void> {
    const first = input.members[0]?.interaction;
    if (!first) {
      throw new HttpError(
        409,
        "RUN_INTERACTION_NOT_FOUND",
        "The approval interaction batch is empty.",
      );
    }
    if (input.toolCalls.length) {
      await this.coordinator.upsertToolCalls(first.runId, input.toolCalls);
    }
    if (input.entries.length) {
      const state = await this.unitOfWork.load(first.runId);
      const existingEntryIds = new Set(
        state?.transitions.flatMap((transition) =>
          transition.entries.map((entry) => entry.id),
        ),
      );
      const missingEntries = input.entries.filter(
        (entry) => !existingEntryIds.has(entry.id),
      );
      if (missingEntries.length) {
        await this.coordinator.appendEntries(first.runId, missingEntries);
      }
    }
    const commands = input.members.map(({ interaction, resolution }) => ({
      interactionId: interaction.id,
      resolutionRequestId: input.resolutionRequestId,
      resolution,
    }));
    if (first.batchToolCallIds) {
      await this.coordinator.resolveInteractionBatch(first.runId, commands);
    } else {
      await this.coordinator.resolveInteraction(first.runId, commands[0]!);
    }
    await this.coordinator.continue(first.runId);
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
      throw new HttpError(
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
    await this.coordinator.resolveInteraction(state.run.runId, command);
    if (input.continueRun) await this.coordinator.continue(state.run.runId);
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
    options?: { signal?: AbortSignal },
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
      throw new HttpError(409, "AGENT_NOT_RUNNING", "Agent is not running.");
    }
    return state;
  }

  private requireAgent(agentId: string): AgentRecord {
    const agent = this.state.agents.get(agentId);
    if (!agent) throw new HttpError(404, "AGENT_NOT_FOUND", "Agent not found.");
    return agent;
  }

  private scopeId(agent: AgentRecord): string {
    return `${agent.conversationId}:${agent.id}`;
  }
}
