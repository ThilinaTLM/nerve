import {
  splitLiveOutputChunks,
  type ToolExecutionOutputUpdate,
} from "@nervekit/tools/execution";
import type { StartTaskRequest, TaskRecord } from "@nervekit/contracts/tasks";
import type {
  TaskProcessEvidence,
  TaskProcessExit,
  TaskProcessPort,
  TaskReadinessOutcome,
  TaskReadinessPort,
  TaskTimerPort,
} from "./task-service.js";
import { isTerminalTaskStatus } from "../model/task-status.js";

export interface TaskProcessSupervisorOptions {
  readonly process: TaskProcessPort;
  readonly logs: {
    append?(
      task: TaskRecord,
      stream: "stdout" | "stderr",
      chunk: Buffer | string,
    ): Promise<void>;
  };
  readonly readiness?: TaskReadinessPort;
  readonly timers?: TaskTimerPort;
  readonly stopTimeoutMs: number;
  readonly get: (id: string) => Promise<TaskRecord | undefined>;
  readonly transitionIfPresent: (
    id: string,
    change: (task: TaskRecord) => Promise<TaskRecord>,
  ) => Promise<TaskRecord | undefined>;
  readonly save: (task: TaskRecord) => Promise<void>;
  readonly publish: (
    type: string,
    data: unknown,
    delivery?: "sequenced" | "ephemeral",
  ) => Promise<void>;
  readonly safeNotify: (
    task: TaskRecord,
    event: "ready" | "completed" | "failed",
  ) => Promise<void>;
  readonly now: () => string;
  readonly finishFromExit: (
    id: string,
    exit: TaskProcessExit,
    forcedStatus?: "cancelled" | "timed_out",
    reason?: string,
  ) => Promise<TaskRecord>;
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
    exit: TaskProcessExit,
    error: unknown,
  ) => void;
  readonly reportFailure: (
    kind: string,
    taskId: string,
    error: unknown,
  ) => void;
}

/** Supervises task process output, readiness, timeouts, and exit settlement. */
export class TaskProcessSupervisor {
  constructor(private readonly options: TaskProcessSupervisorOptions) {}

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

  watchReadiness(id: string, request: StartTaskRequest): Promise<void> {
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

  exit(id: string, exit: TaskProcessExit): Promise<void> {
    return this.recordExit(id, exit);
  }

  async waitForExit(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<
    TaskProcessExit | TaskProcessEvidence | "timeout" | "unavailable"
  > {
    if (this.options.process.waitForExit)
      return this.options.process.waitForExit(task, timeoutMs);
    return this.options.process.inspect(task);
  }

  private async handleBackgroundFailure(
    kind: "readiness" | "runtime_timeout",
    id: string,
    error: unknown,
  ): Promise<void> {
    if (!(await this.options.get(id))) return;
    this.options.reportFailure(kind, id, error);
    await this.options.transitionIfPresent(id, async (task) => {
      if (isTerminalTaskStatus(task.status)) return task;
      if (kind === "readiness" && task.readiness.outcome === "pending") {
        task.readiness.outcome = "unavailable";
        task.updatedAt = this.options.now();
        await this.options.save(task);
        await this.options.publish("task.readiness_failed", {
          task,
          reason: boundedErrorMessage(error),
        });
      } else if (kind === "runtime_timeout") {
        task.error = `Runtime timeout watcher failed: ${boundedErrorMessage(error)}`;
        task.updatedAt = this.options.now();
        await this.options.save(task);
      }
      return task;
    });
  }

  private async runReadiness(
    id: string,
    request: StartTaskRequest,
  ): Promise<void> {
    const task = await this.require(id);
    const readiness: TaskReadinessOutcome = this.options.readiness
      ? await this.options.readiness.wait(task, request)
      : "unavailable";
    const outcome =
      typeof readiness === "object" ? readiness.outcome : readiness;
    await this.options.transitionIfPresent(id, async (current) => {
      if (isTerminalTaskStatus(current.status) || current.status === "stopping")
        return current;
      current.readiness.outcome = outcome;
      if (typeof readiness === "object" && readiness.matched)
        current.readiness.matched = readiness.matched;
      current.updatedAt = this.options.now();
      if (outcome === "ready") {
        current.status = "ready";
        current.readiness.readyAt = current.updatedAt;
        await this.options.save(current);
        await this.options.publish("task.ready", { task: current });
        await this.options.safeNotify(current, "ready");
      } else {
        await this.options.save(current);
        if (outcome === "timeout")
          await this.options.publish("task.readiness_failed", {
            task: current,
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
    const task = await this.options.get(id);
    if (!task) return;
    await this.options.logs.append?.(task, stream, rawChunk);
    const text = Buffer.isBuffer(rawChunk)
      ? rawChunk.toString("utf8")
      : rawChunk;
    for (const chunk of splitLiveOutputChunks(text)) {
      try {
        await this.options.publish(
          "task.output",
          { taskId: id, stream, text: chunk },
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

  private async recordExit(id: string, exit: TaskProcessExit): Promise<void> {
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
    const task = await this.options.transitionIfPresent(id, async (current) => {
      if (isTerminalTaskStatus(current.status) || current.status === "stopping")
        return current;
      this.options.setStopReason(id, "timed_out");
      current.status = "stopping";
      current.error = "Task exceeded maximum runtime.";
      current.updatedAt = this.options.now();
      await this.options.save(current);
      await this.options.publish("task.stop_requested", {
        task: current,
        signal: "SIGTERM",
        reason: "runtime_timeout",
      });
      return current;
    });
    if (
      !task ||
      isTerminalTaskStatus(task.status) ||
      this.options.getStopReason(id) !== "timed_out"
    )
      return;
    await this.options.process.signal(task, {
      signal: "SIGTERM",
      timeoutMs: this.options.stopTimeoutMs,
      reason: "runtime_timeout",
    });
    let exit = await this.waitForExit(task, this.options.stopTimeoutMs);
    if (exit === "timeout") {
      await this.options.process.signal(task, {
        signal: "SIGKILL",
        timeoutMs: this.options.stopTimeoutMs,
        reason: "runtime_timeout_escalation",
      });
      exit = await this.waitForExit(task, this.options.stopTimeoutMs);
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

  private async require(id: string): Promise<TaskRecord> {
    const task = await this.options.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }
}

function boundedErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4_096,
  );
}
