import type {
  AgentRecord,
  ContextUsage,
  PromptRequest,
  ToolName,
} from "@nervekit/contracts";
import type { RunCoordinator } from "@nervekit/host-runtime";
import { HttpError } from "../../http/errors.js";
import type { RuntimeState } from "../../runtime/runtime-state.js";
import type { ExploreReport } from "../agents/run/subagent-runner.js";
import type { WorkbenchRunUnitOfWork } from "./run-transition.repository.js";

export interface WorkbenchRunFeatureMechanics {
  activeToolNamesFor(agent: AgentRecord): Promise<ToolName[]>;
  getContextUsage(conversationId: string): Promise<ContextUsage>;
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

  async promptAgent(agentId: string, request: PromptRequest): Promise<void> {
    const agent = this.requireAgent(agentId);
    const scopeId = this.scopeId(agent);
    const active = await this.unitOfWork.findActive(scopeId);
    if (active) {
      const behavior = request.behavior ?? "steer";
      if (behavior === "reject-if-busy") {
        throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
      }
      if (behavior === "follow-up") {
        await this.coordinator.followUp(active.run.runId, request.text);
      } else {
        await this.coordinator.steer(active.run.runId, request.text);
      }
      return;
    }
    await this.coordinator.start({
      conversationId: agent.conversationId,
      agentId: agent.id,
      projectId: agent.projectId,
      scopeId,
      prompt: request.text,
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
    const state = await this.requireCurrentRun(agentId);
    await this.coordinator.cancel(state.run.runId, "user requested abort");
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
