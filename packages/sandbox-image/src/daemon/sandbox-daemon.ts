import type { SandboxConfigV1 } from "@nervekit/shared";
import { SandboxCommandRouter } from "./command-router.js";
import { DaemonStatusMachine } from "./daemon-status.js";
import { buildSandboxSnapshot } from "./snapshots.js";

export class SandboxDaemon {
  readonly status = new DaemonStatusMachine();
  readonly router = new SandboxCommandRouter();
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly configDigest: string,
    private readonly instanceId = `inst_${Date.now()}`,
  ) {
    this.registerBuiltins();
  }
  start(): void {
    this.status.transition("ready");
  }
  private registerBuiltins(): void {
    this.router.register("sandbox.status.get", () => ({
      instanceId: this.instanceId,
      status: this.status.status,
      configDigest: this.configDigest,
      updatedAt: new Date().toISOString(),
    }));
    this.router.register("sandbox.snapshot.get", () =>
      buildSandboxSnapshot({
        config: this.config,
        configDigest: this.configDigest,
        status: this.status.status,
      }),
    );
    this.router.register("sandbox.run.start", (params) => ({
      accepted: true,
      ...(params as object),
      conversationId:
        (params as { conversationId?: string }).conversationId ??
        `conv_${Date.now()}`,
      agentId: (params as { agentId?: string }).agentId ?? "agent_main",
      runId: `run_${Date.now()}`,
      status: "queued",
    }));
    this.router.register("sandbox.run.continue", (params) => ({
      accepted: true,
      ...(params as object),
      status: "queued",
    }));
    this.router.register("sandbox.run.cancel", (params) => ({
      accepted: true,
      ...(params as object),
      status: "cancelled",
      cancellationRequested: true,
    }));
    this.router.register("sandbox.input.submit", (params) => ({
      accepted: true,
      ...(params as object),
      status: "queued",
    }));
    this.router.register("sandbox.approval.resolve", (params) => ({
      accepted: true,
      ...(params as object),
      status: "queued",
    }));
  }
}
