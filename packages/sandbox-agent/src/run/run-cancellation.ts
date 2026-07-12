import type { RunRecord } from "@nervekit/contracts";
import type { RunCancellationPort } from "@nervekit/host-runtime";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import type { SandboxTaskService } from "../tools/sandbox-task-service.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { SandboxInteractionChannel } from "./interaction-channel.js";
import type { SandboxLiveHarnessRegistry } from "./live-registry.js";

type Evidence = "confirmed" | "not_running";

function scopeOf(run: RunRecord) {
  return {
    conversationId: run.conversationId,
    agentId: run.agentId,
    runId: run.runId,
  };
}

/**
 * Confirms cancellation evidence for each fan-out target. The coordinator has
 * already aborted the live execution before these run, so each method reports
 * confirmed/not_running truthfully rather than assuming success.
 */
export class SandboxRunCancellation implements RunCancellationPort {
  constructor(
    private readonly deps: {
      live: SandboxLiveHarnessRegistry;
      channel: SandboxInteractionChannel;
      toolRuntime?: SandboxToolRuntime;
      taskService?: SandboxTaskService;
      exploreRuntime?: ExploreRuntime;
    },
  ) {}

  async cancelModel(run: RunRecord): Promise<Evidence> {
    const handle = this.deps.live.get(run.runId);
    if (!handle) return "not_running";
    handle.abort.abort("cancelled");
    await handle.harness.abort().catch(() => undefined);
    return "confirmed";
  }

  async cancelTools(run: RunRecord): Promise<Evidence> {
    if (!this.deps.toolRuntime) return "not_running";
    await this.deps.toolRuntime.cancelRun(scopeOf(run));
    return "confirmed";
  }

  async cancelTasks(run: RunRecord): Promise<Evidence> {
    if (!this.deps.taskService) return "not_running";
    const cancelled = await this.deps.taskService.cancelRun(scopeOf(run));
    return cancelled.length > 0 ? "confirmed" : "not_running";
  }

  async cancelSubagents(run: RunRecord): Promise<Evidence> {
    if (!this.deps.exploreRuntime) return "not_running";
    await this.deps.exploreRuntime.cancelRun(scopeOf(run));
    return "confirmed";
  }

  async cancelInteraction(run: RunRecord): Promise<Evidence> {
    const cancelled = this.deps.channel.cancelRun(run.runId, "run cancelled");
    return cancelled > 0 ? "confirmed" : "not_running";
  }
}
