import type { SandboxConfigV1 } from "@nervekit/shared";
import { resolveModelSelection } from "../models/model-catalog.js";
import type { RunManager } from "./run-manager.js";
import type { RunState } from "./run-state-store.js";

export type SandboxAgentRuntimeOptions = {
  runs?: RunManager;
};

export class SandboxAgentRuntime {
  private readonly active = new Map<string, AbortController>();
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly options: SandboxAgentRuntimeOptions = {},
  ) {}
  describe(): Record<string, unknown> {
    return {
      mainModel: resolveModelSelection(
        this.config,
        this.config.agent.mainModel,
      ),
      mode: this.config.agent.mode ?? "normal",
      activeRuns: this.active.size,
    };
  }

  async startRun(input: Parameters<RunManager["start"]>[0]): Promise<RunState> {
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    const run = await this.options.runs.start(input);
    this.active.set(key(run), new AbortController());
    return run;
  }

  async continueRun(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
  }): Promise<void> {
    if (!this.active.has(key(scope)))
      this.active.set(key(scope), new AbortController());
  }

  async steerRun(
    _scope: { conversationId: string; agentId: string; runId: string },
    _text: string,
  ): Promise<void> {
    throw new Error(
      "UNAVAILABLE: provider steering is not available until a harness provider is configured",
    );
  }

  async cancelRun(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
    reason?: string;
  }): Promise<RunState> {
    const controller = this.active.get(key(scope));
    controller?.abort();
    this.active.delete(key(scope));
    if (!this.options.runs)
      throw new Error("UNAVAILABLE: run manager is not configured");
    return this.options.runs.cancel(scope);
  }

  recoverActiveRuns(): void {
    this.active.clear();
  }

  snapshot(): Record<string, unknown> {
    return { activeRuns: Array.from(this.active.keys()) };
  }
}

function key(scope: {
  conversationId: string;
  agentId: string;
  runId: string;
}): string {
  return `${scope.conversationId}/${scope.agentId}/${scope.runId}`;
}
