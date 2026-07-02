import type { SandboxConfigV1 } from "@nervekit/shared";
import type { SandboxStateStores } from "../state/sandbox-state.js";
import { SandboxCommandRouter } from "./command-router.js";
import { DaemonStatusMachine } from "./daemon-status.js";
import { buildSandboxSnapshot } from "./snapshots.js";

export class SandboxDaemon {
  readonly status = new DaemonStatusMachine();
  readonly router = new SandboxCommandRouter();
  readonly startedAt = new Date().toISOString();
  constructor(
    private readonly config: SandboxConfigV1,
    private readonly configDigest: string,
    private readonly instanceId = `inst_${Date.now()}`,
    private readonly state?: SandboxStateStores,
  ) {
    this.registerBuiltins();
  }
  start(): void {
    this.status.transition("ready");
  }
  private registerBuiltins(): void {
    this.router.register("sandbox.status.get", () => ({
      sandboxId: this.config.identity?.sandboxId,
      instanceId: this.instanceId,
      status: this.status.status,
      configDigest: this.configDigest,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      connectivity: { state: "connected", connectedAt: this.startedAt },
      conversations: [],
      runs: [],
    }));
    this.router.register("sandbox.snapshot.get", () =>
      buildSandboxSnapshot({
        config: this.config,
        configDigest: this.configDigest,
        status: this.status.status,
        connectivity: { state: "connected", connectedAt: this.startedAt },
        conversations: [],
        runs: [],
      }),
    );
    this.router.register("sandbox.run.start", async (params) => {
      const accepted = await this.acceptCommand("sandbox.run.start", params);
      const runId = `run_${Date.now()}`;
      const conversationId =
        (params as { conversationId?: string }).conversationId ??
        `conv_${Date.now()}`;
      const agentId = (params as { agentId?: string }).agentId ?? "agent_main";
      await this.state?.events.append({
        type: "run.started",
        durability: "durable",
        data: { commandId: accepted.commandId, status: "queued" },
        conversationId,
        agentId,
        runId,
      });
      return {
        accepted: true,
        commandId: accepted.commandId,
        conversationId,
        agentId,
        runId,
        status: "queued",
      };
    });
    this.router.register("sandbox.run.continue", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.run.continue", params),
      ...(params as object),
      status: "queued",
    }));
    this.router.register("sandbox.run.cancel", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.run.cancel", params),
      ...(params as object),
      status: "cancelled",
      cancellationRequested: true,
    }));
    this.router.register("sandbox.input.submit", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.input.submit", params),
      ...(params as object),
      status: "queued",
    }));
    this.router.register("sandbox.approval.resolve", async (params) => ({
      accepted: true,
      commandId: await this.commandId("sandbox.approval.resolve", params),
      ...(params as object),
      status: "queued",
    }));
  }

  private async commandId(method: string, params: unknown): Promise<string> {
    return (await this.acceptCommand(method, params)).commandId;
  }

  private async acceptCommand(
    method: string,
    params: unknown,
  ): Promise<{ commandId: string }> {
    const commandId = (params as { commandId?: string }).commandId;
    if (!commandId) return { commandId: `cmd_${Date.now()}` };
    await this.state?.commands.accept({
      commandId,
      messageId: `msg_${Date.now()}`,
      method,
      params,
      conversationId: (params as { conversationId?: string }).conversationId,
      agentId: (params as { agentId?: string }).agentId,
      runId: (params as { runId?: string }).runId,
    });
    return { commandId };
  }
}
