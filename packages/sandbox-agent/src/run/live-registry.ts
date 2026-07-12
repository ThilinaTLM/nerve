import type { AgentHarness } from "@nervekit/host-runtime/harness";

export interface LiveHarnessHandle {
  readonly harness: AgentHarness;
  readonly abort: AbortController;
}

/**
 * Non-authoritative registry of currently live harness handles keyed by runId.
 * Used only to abort a live model call or steer/follow-up an in-flight turn.
 * Run status, waits, prompts, and recovery are always sourced from canonical
 * transition state, never from this map.
 */
export class SandboxLiveHarnessRegistry {
  private readonly handles = new Map<string, LiveHarnessHandle>();

  set(runId: string, handle: LiveHarnessHandle): void {
    this.handles.set(runId, handle);
  }

  get(runId: string): LiveHarnessHandle | undefined {
    return this.handles.get(runId);
  }

  delete(runId: string): void {
    this.handles.delete(runId);
  }
}
