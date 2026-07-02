import type { RunState, RunStateStore } from "./run-state-store.js";
export class RunManager {
  private counter = 0;
  constructor(private readonly store: RunStateStore) {}
  async start(input: {
    conversationId?: string;
    agentId?: string;
    prompt?: string;
  }): Promise<RunState> {
    const now = new Date().toISOString();
    const state: RunState = {
      conversationId: input.conversationId ?? `conv_${Date.now()}`,
      agentId: input.agentId ?? "agent_main",
      runId: `run_${Date.now()}_${++this.counter}`,
      status: "queued",
      updatedAt: now,
      prompt: input.prompt,
    };
    await this.store.write(state);
    return state;
  }
}
