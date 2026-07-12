import type { ManagedSandboxRecord } from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { recordManagerLifecycleEvent } from "../events/manager-events.js";
import { transitionSandboxLifecycle } from "./lifecycle-state.js";

const bootProgressEvent =
  /^(sandbox\.preflight\.|sandbox\.models\.|sandbox\.context\.|sandbox\.config\.loaded|sandbox\.secret_store\.|sandbox\.setup\.|sandbox\.boot\.|sandbox\.skills\.|sandbox\.ready)/;

export class SandboxLifecycleWatchdog {
  constructor(private readonly state: ManagerState) {}

  async check(): Promise<void> {
    for (const record of await this.state.sandboxes.list()) {
      await this.checkRecord(record).catch((error) => {
        this.state.logger.warn("sandbox lifecycle watchdog check failed", {
          sandboxId: record.sandboxId,
          err: error,
        });
      });
    }
  }

  private async checkRecord(record: ManagedSandboxRecord): Promise<void> {
    const state = record.lifecycleState;
    if (state === "failed" || state === "ready" || state === "degraded") return;
    const now = Date.now();
    const updatedAt = Date.parse(record.lifecycleUpdatedAt ?? record.updatedAt);
    if (
      (state === "container_creating" || state === "container_starting") &&
      now - updatedAt > this.state.config.containerStartTimeoutMs
    ) {
      await this.fail(
        record,
        "CONTAINER_START_TIMEOUT",
        "Container did not start before the watchdog timeout",
      );
      return;
    }
    if (
      state === "container_started" &&
      now - updatedAt > this.state.config.daemonConnectTimeoutMs
    ) {
      await this.fail(
        record,
        "DAEMON_CONNECT_TIMEOUT",
        "Sandbox daemon did not connect before the watchdog timeout",
      );
      return;
    }
    if (state !== "daemon_connected" && state !== "booting") return;
    const connectedAt = Date.parse(
      record.daemon?.connectedAt ??
        record.lifecycleUpdatedAt ??
        record.updatedAt,
    );
    if (now - connectedAt > this.state.config.bootReadyTimeoutMs) {
      await this.fail(
        record,
        "BOOT_READY_TIMEOUT",
        "Sandbox daemon did not become ready before the watchdog timeout",
      );
      return;
    }
    const lastProgress = await this.lastBootProgressAt(record);
    if (
      state === "booting" &&
      lastProgress &&
      now - lastProgress > this.state.config.bootStallTimeoutMs
    ) {
      await this.fail(
        record,
        "BOOT_STALL_TIMEOUT",
        "Sandbox boot made no progress before the watchdog timeout",
      );
    }
  }

  private async lastBootProgressAt(
    record: ManagedSandboxRecord,
  ): Promise<number | undefined> {
    const events = await this.state.events.list(record.sandboxId);
    const latest = events
      .filter((event) => bootProgressEvent.test(event.type))
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
      .at(-1);
    return latest?.ts ? Date.parse(latest.ts) : undefined;
  }

  private async fail(
    record: ManagedSandboxRecord,
    code: string,
    message: string,
  ): Promise<void> {
    await transitionSandboxLifecycle(
      {
        store: this.state.sandboxes,
        recordEvent: (event) => recordManagerLifecycleEvent(this.state, event),
      },
      record.sandboxId,
      "failed",
      {
        observedState:
          record.observedState === "running" ? "running" : "failed",
        lastError: { code, message },
        reason: code,
        force: true,
      },
    );
  }
}
