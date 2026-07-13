import type {
  AgentRecord,
  ContextUsage,
  ConversationEntry,
  PromptRequest,
  ToolCallTranscriptRecord,
  ToolName,
} from "@nervekit/contracts";
import { parseInlineCommandPrompt } from "@nervekit/contracts";
import type { RunCoordinator } from "@nervekit/host-runtime";
import { HttpError } from "../../http/errors.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ExploreReport } from "../agents/run/subagent-runner.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

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
    this.requireAgent(agentId);
    const states = await this.unitOfWork.list();
    return states
      .flatMap((state) => state.prompts)
      .filter(
        (prompt) =>
          prompt.agentId === agentId &&
          (prompt.status === "queued" || prompt.status === "accepted"),
      )
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  async cancelQueuedPrompt(agentId: string, promptId: string) {
    this.requireAgent(agentId);
    const states = await this.unitOfWork.list();
    const state = states.find((candidate) =>
      candidate.prompts.some(
        (prompt) => prompt.id === promptId && prompt.agentId === agentId,
      ),
    );
    if (!state) {
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

  async continueFromFailedTurn(
    agentId: string,
    failedEntryId: string,
  ): Promise<void> {
    void failedEntryId;
    await this.continueAgent(agentId);
  }

  async resumeRun(agentId: string): Promise<void> {
    await this.continueAgent(agentId);
  }

  async abortAgent(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const state = await this.unitOfWork.findActive(this.scopeId(agent));
    if (!state) return;
    await this.coordinator.cancel(state.run.runId, "user requested abort");
  }

  async assertPendingInteractionForToolCall(toolCallId: string): Promise<void> {
    const states = await this.unitOfWork.list();
    const interaction = states
      .flatMap((state) => state.interactions)
      .find((candidate) => candidate.toolCallId === toolCallId);
    if (!interaction || interaction.status !== "pending") {
      throw new HttpError(
        409,
        "RUN_INTERACTION_NOT_PENDING",
        "The run interaction is not pending.",
      );
    }
  }

  async resolveInteractionForToolCall(input: {
    toolCallId: string;
    resolutionRequestId: string;
    resolution: Record<string, unknown>;
    entries?: readonly ConversationEntry[];
    toolCalls?: readonly ToolCallTranscriptRecord[];
    continueRun: boolean;
    completeRun?: boolean;
  }): Promise<void> {
    const states = await this.unitOfWork.list();
    const state = states.find((candidate) =>
      candidate.interactions.some(
        (interaction) => interaction.toolCallId === input.toolCallId,
      ),
    );
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
    if (input.toolCalls?.length) {
      await this.coordinator.upsertToolCalls(state.run.runId, input.toolCalls);
    }
    if (input.entries?.length) {
      await this.coordinator.appendEntries(state.run.runId, input.entries);
    }
    await this.coordinator.resolveInteraction(state.run.runId, {
      interactionId: interaction.id,
      resolutionRequestId: input.resolutionRequestId,
      resolution: input.resolution,
    });
    if (input.completeRun) {
      await this.coordinator.completeResolvedInteraction(
        state.run.runId,
        interaction.id,
      );
    } else if (input.continueRun) {
      await this.coordinator.continue(state.run.runId);
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
