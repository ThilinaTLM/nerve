import {
  splitLiveOutputChunks,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools/execution";
import type {
  StartLaunchRequest,
  LaunchRecord,
} from "@nervekit/contracts/launches";
import type {
  LaunchProcessEvidence,
  LaunchProcessExit,
  LaunchProcessPort,
  LaunchReadinessOutcome,
  LaunchReadinessPort,
  LaunchTimerPort,
} from "./launch.service.js";
import { isTerminalLaunchStatus } from "../model/launch-status.js";

export interface LaunchProcessSupervisorOptions {
  readonly process: LaunchProcessPort;
  readonly logs: {
    append?(
      launch: LaunchRecord,
      stream: "stdout" | "stderr",
      chunk: Buffer | string,
    ): Promise<void>;
  };
  readonly readiness?: LaunchReadinessPort;
  readonly timers?: LaunchTimerPort;
  readonly stopTimeoutMs: number;
  readonly get: (id: string) => Promise<LaunchRecord | undefined>;
  readonly transitionIfPresent: (
    id: string,
    change: (launch: LaunchRecord) => Promise<LaunchRecord>,
  ) => Promise<LaunchRecord | undefined>;
  readonly save: (launch: LaunchRecord) => Promise<void>;
  readonly publish: (
    type: string,
    data: unknown,
    delivery?: "sequenced" | "ephemeral",
  ) => Promise<void>;
  readonly now: () => string;
  readonly finishFromExit: (
    id: string,
    exit: LaunchProcessExit,
    forcedStatus?: "cancelled" | "timed_out",
    reason?: string,
  ) => Promise<LaunchRecord>;
  readonly outputObserver: (
    id: string,
    update: ToolExecutionOutputUpdate,
  ) => Promise<void>;
  readonly setStopReason: (
    id: string,
    reason: "cancelled" | "timed_out",
  ) => void;
  readonly getStopReason: (id: string) => "cancelled" | "timed_out" | undefined;
  readonly clearStopReason: (id: string) => void;
  readonly clearTerminalFailure: (id: string) => void;
  readonly saveTerminalFailure: (
    id: string,
    exit: LaunchProcessExit,
    error: unknown,
  ) => void;
  readonly reportFailure: (
    kind: string,
    launchId: string,
    error: unknown,
  ) => void;
}

/** Supervises launch process output, readiness, timeouts, and exit settlement. */
export class LaunchProcessSupervisor {
  constructor(private readonly options: LaunchProcessSupervisorOptions) {}

  launchBackground(
    kind: "readiness" | "runtime_timeout",
    id: string,
    operation: Promise<void>,
  ): void {
    void operation
      .catch((error) => this.handleBackgroundFailure(kind, id, error))
      .catch((error) =>
        this.options.reportFailure(`${kind}_failure_handler`, id, error),
      );
  }

  watchReadiness(id: string, request: StartLaunchRequest): Promise<void> {
    return this.runReadiness(id, request);
  }

  watchRuntimeTimeout(id: string, timeoutMs: number): Promise<void> {
    return this.runRuntimeTimeout(id, timeoutMs);
  }

  output(
    id: string,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void> {
    return this.recordOutput(id, stream, chunk);
  }

  exit(id: string, exit: LaunchProcessExit): Promise<void> {
    return this.recordExit(id, exit);
  }

  async waitForExit(
    launch: LaunchRecord,
    timeoutMs: number,
  ): Promise<
    LaunchProcessExit | LaunchProcessEvidence | "timeout" | "unavailable"
  > {
    if (this.options.process.waitForExit)
      return this.options.process.waitForExit(launch, timeoutMs);
    return this.options.process.inspect(launch);
  }

  private async handleBackgroundFailure(
    kind: "readiness" | "runtime_timeout",
    id: string,
    error: unknown,
  ): Promise<void> {
    if (!(await this.options.get(id))) return;
    this.options.reportFailure(kind, id, error);
    await this.options.transitionIfPresent(id, async (launch) => {
      if (isTerminalLaunchStatus(launch.status)) return launch;
      if (kind === "readiness" && launch.readiness.outcome === "pending") {
        launch.readiness.outcome = "unavailable";
        launch.updatedAt = this.options.now();
        await this.options.save(launch);
        await this.options.publish("launch.readiness_failed", {
          launch,
          reason: boundedErrorMessage(error),
        });
      } else if (kind === "runtime_timeout") {
        launch.error = `Runtime timeout watcher failed: ${boundedErrorMessage(error)}`;
        launch.updatedAt = this.options.now();
        await this.options.save(launch);
      }
      return launch;
    });
  }

  private async runReadiness(
    id: string,
    request: StartLaunchRequest,
  ): Promise<void> {
    const launch = await this.require(id);
    const readiness: LaunchReadinessOutcome = this.options.readiness
      ? await this.options.readiness.wait(launch, request)
      : "unavailable";
    const outcome =
      typeof readiness === "object" ? readiness.outcome : readiness;
    await this.options.transitionIfPresent(id, async (current) => {
      if (
        isTerminalLaunchStatus(current.status) ||
        current.status === "stopping"
      )
        return current;
      current.readiness.outcome = outcome;
      if (typeof readiness === "object" && readiness.matched)
        current.readiness.matched = readiness.matched;
      current.updatedAt = this.options.now();
      if (outcome === "ready") {
        current.status = "ready";
        current.readiness.readyAt = current.updatedAt;
        await this.options.save(current);
        await this.options.publish("launch.ready", { launch: current });
      } else {
        await this.options.save(current);
        if (outcome === "timeout")
          await this.options.publish("launch.readiness_failed", {
            launch: current,
          });
      }
      return current;
    });
  }

  private async recordOutput(
    id: string,
    stream: "stdout" | "stderr",
    rawChunk: Buffer | string,
  ): Promise<void> {
    const launch = await this.options.get(id);
    if (!launch) return;
    await this.options.logs.append?.(launch, stream, rawChunk);
    const text = Buffer.isBuffer(rawChunk)
      ? rawChunk.toString("utf8")
      : rawChunk;
    for (const chunk of splitLiveOutputChunks(text)) {
      try {
        await this.options.publish(
          "launch.output",
          { launchId: id, stream, text: chunk },
          "ephemeral",
        );
      } catch (error) {
        this.options.reportFailure("output_event", id, error);
      }
      try {
        await this.options.outputObserver(id, {
          kind: "output",
          stream,
          chunk,
        });
      } catch (error) {
        this.options.reportFailure("output_observer", id, error);
      }
    }
  }

  private async recordExit(id: string, exit: LaunchProcessExit): Promise<void> {
    try {
      await this.options.finishFromExit(id, exit);
      this.options.clearTerminalFailure(id);
    } catch (error) {
      this.options.saveTerminalFailure(id, exit, error);
      this.options.reportFailure("terminal_persistence", id, error);
    }
  }

  private async runRuntimeTimeout(
    id: string,
    timeoutMs: number,
  ): Promise<void> {
    await (this.options.timers?.sleep(timeoutMs) ??
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)));
    const launch = await this.options.transitionIfPresent(
      id,
      async (current) => {
        if (
          isTerminalLaunchStatus(current.status) ||
          current.status === "stopping"
        )
          return current;
        this.options.setStopReason(id, "timed_out");
        current.status = "stopping";
        current.error = "Launch exceeded maximum runtime.";
        current.updatedAt = this.options.now();
        await this.options.save(current);
        await this.options.publish("launch.stop_requested", {
          launch: current,
          signal: "SIGTERM",
          reason: "runtime_timeout",
        });
        return current;
      },
    );
    if (
      !launch ||
      isTerminalLaunchStatus(launch.status) ||
      this.options.getStopReason(id) !== "timed_out"
    )
      return;
    await this.options.process.signal(launch, {
      signal: "SIGTERM",
      timeoutMs: this.options.stopTimeoutMs,
      reason: "runtime_timeout",
    });
    let exit = await this.waitForExit(launch, this.options.stopTimeoutMs);
    if (exit === "timeout") {
      await this.options.process.signal(launch, {
        signal: "SIGKILL",
        timeoutMs: this.options.stopTimeoutMs,
        reason: "runtime_timeout_escalation",
      });
      exit = await this.waitForExit(launch, this.options.stopTimeoutMs);
    }
    if (typeof exit === "object")
      await this.options.finishFromExit(id, exit, "timed_out");
    else if (exit === "exited")
      await this.options.finishFromExit(
        id,
        { exitedAt: this.options.now() },
        "timed_out",
      );
  }

  private async require(id: string): Promise<LaunchRecord> {
    const launch = await this.options.get(id);
    if (!launch) throw new Error(`Unknown launch: ${id}`);
    return launch;
  }
}

function boundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4_096,
  );
}
