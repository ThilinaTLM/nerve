import type {
  AgentRecord,
  RunRecord,
  RunTransitionRecord,
} from "@nervekit/contracts";
import type {
  RunHydratedState,
  RunTransitionObserverPort,
} from "@nervekit/host-runtime";
import type { RuntimeState } from "../../runtime/runtime-state.js";

export class WorkbenchRunStatusProjector implements RunTransitionObserverPort {
  constructor(
    private readonly state: RuntimeState,
    private readonly update: (
      agent: AgentRecord,
      status: AgentRecord["status"],
    ) => Promise<void>,
  ) {}

  async committed(transition: RunTransitionRecord): Promise<void> {
    await this.project(transition.run);
  }

  async rebuild(states: readonly RunHydratedState[]): Promise<void> {
    const latestByAgent = new Map<string, RunRecord>();
    for (const { run } of states) {
      const current = latestByAgent.get(run.agentId);
      if (
        !current ||
        current.updatedAt < run.updatedAt ||
        (current.updatedAt === run.updatedAt && current.revision < run.revision)
      ) {
        latestByAgent.set(run.agentId, run);
      }
    }
    for (const run of latestByAgent.values()) await this.project(run);
  }

  private async project(run: RunRecord): Promise<void> {
    const agent = this.state.agents.get(run.agentId);
    if (!agent) return;
    const status = agentStatusForRun(run.status);
    if (agent.status === status) return;
    await this.update(agent, status);
  }
}

export function agentStatusForRun(
  status: RunRecord["status"],
): AgentRecord["status"] {
  if (
    ["starting", "running", "retrying", "cancellation_requested"].includes(
      status,
    )
  ) {
    return "running";
  }
  if (status === "waiting" || status === "suspended") {
    return "awaiting_user";
  }
  if (status === "completed") return "idle";
  if (status === "cancelled") return "aborted";
  return "error";
}
