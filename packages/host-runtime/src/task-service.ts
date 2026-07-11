import type {
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import type { ClockPort, DomainEventPublisherPort, IdPort } from "./index.js";

export interface TaskRepositoryPort {
  get(id: string): Promise<TaskRecord | undefined>;
  list(): Promise<TaskRecord[]>;
  save(task: TaskRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface TaskProcessExit {
  readonly exitCode?: number;
  readonly signal?: string;
  readonly exitedAt: string;
}

export interface TaskProcessCallbacks {
  readonly onOutput?: (
    stream: "stdout" | "stderr",
    text: string,
  ) => void | Promise<void>;
  readonly onExit?: (exit: TaskProcessExit) => void | Promise<void>;
}

export interface TaskProcessPort {
  spawn(
    input: StartTaskRequest & { taskId: string },
    callbacks?: TaskProcessCallbacks,
  ): Promise<TaskRecord["runtime"]>;
  signal(task: TaskRecord, options: TaskCancelOptions): Promise<void>;
  inspect(task: TaskRecord): Promise<"running" | "exited" | "unknown">;
  waitForExit?(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<TaskProcessExit | "timeout" | "unavailable">;
  inspectPorts?(task: TaskRecord): Promise<readonly number[] | "unavailable">;
}

export interface TaskLogPort {
  query(task: TaskRecord, query: TaskLogQuery): Promise<TaskLogQueryResponse>;
  append?(
    task: TaskRecord,
    stream: "stdout" | "stderr",
    text: string,
  ): Promise<void>;
  remove(task: TaskRecord): Promise<void>;
}

export interface TaskReadinessPort {
  wait(
    task: TaskRecord,
    request: StartTaskRequest,
  ): Promise<"ready" | "timeout" | "exited" | "unavailable">;
}

export interface TaskCancelOptions {
  readonly signal?: "SIGTERM" | "SIGINT" | "SIGKILL";
  readonly timeoutMs?: number;
  readonly reason?: string;
}

export interface TaskNotificationPort {
  notify(
    task: TaskRecord,
    event: "ready" | "completed" | "failed",
  ): Promise<void>;
}

export interface TaskServicePorts {
  readonly repository: TaskRepositoryPort;
  readonly process: TaskProcessPort;
  readonly logs: TaskLogPort;
  readonly readiness?: TaskReadinessPort;
  readonly events: DomainEventPublisherPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly notifications?: TaskNotificationPort;
  readonly workspaceRoot: string;
}

const terminalStatuses = new Set<TaskRecord["status"]>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "orphaned",
]);

export class TaskService {
  constructor(private readonly ports: TaskServicePorts) {}

  async start(request: StartTaskRequest): Promise<TaskRecord> {
    assertWorkspacePath(request.cwd, this.ports.workspaceRoot);
    const now = this.ports.clock.now().toISOString();
    const task: TaskRecord = {
      id: this.ports.ids.next(),
      name: request.name,
      groupId: request.groupId,
      groupName: request.groupName,
      workerId: request.workerId,
      projectId: request.projectId,
      conversationId: request.conversationId,
      agentId: request.agentId,
      cwd: request.cwd,
      command: request.command,
      envInfo: request.env
        ? {
            keys: Object.keys(request.env).sort(),
            persisted: true,
            redacted: true,
          }
        : undefined,
      status: "starting",
      readiness: {
        readyUrl: request.readyUrl,
        readyOnUrl: request.readyOnUrl,
        readyPattern: request.readyPattern,
        timeoutMs: request.readyTimeoutMs,
        outcome:
          request.readyUrl || request.readyOnUrl || request.readyPattern
            ? "pending"
            : "none",
      },
      stdoutPath: "",
      stderrPath: "",
      logsPath: "",
      startedAt: now,
      updatedAt: now,
      timeoutMs: request.timeoutMs,
      origin: { kind: "api" },
      visibility: "background",
    };
    await this.ports.repository.save(task);
    await this.publish("task.created", task);
    try {
      task.runtime = await this.ports.process.spawn(
        {
          ...request,
          taskId: task.id,
        },
        {
          onOutput: (stream, text) => this.recordOutput(task.id, stream, text),
          onExit: (exit) => this.recordExit(task.id, exit),
        },
      );
      task.status = "running";
      task.updatedAt = this.ports.clock.now().toISOString();
      await this.ports.repository.save(task);
      await this.publish("task.started", task);
      if (task.readiness.outcome === "pending")
        void this.watchReadiness(task, request);
      if (request.timeoutMs)
        void this.watchRuntimeTimeout(task.id, request.timeoutMs);
      return task;
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.finishedAt = this.ports.clock.now().toISOString();
      task.updatedAt = task.finishedAt;
      await this.ports.repository.save(task);
      await this.publish("task.failed", task);
      throw error;
    }
  }

  get(id: string): Promise<TaskRecord | undefined> {
    return this.ports.repository.get(id);
  }

  async list(
    filter: Partial<
      Pick<TaskRecord, "projectId" | "conversationId" | "agentId" | "groupId">
    > = {},
  ): Promise<TaskRecord[]> {
    const records = await this.ports.repository.list();
    return records.filter((record) =>
      Object.entries(filter).every(
        ([key, value]) =>
          value === undefined || record[key as keyof TaskRecord] === value,
      ),
    );
  }

  async logs(id: string, query: TaskLogQuery): Promise<TaskLogQueryResponse> {
    return this.ports.logs.query(await this.require(id), query);
  }

  async cancel(
    id: string,
    options: TaskCancelOptions = {},
  ): Promise<TaskRecord> {
    const task = await this.require(id);
    if (terminalStatuses.has(task.status)) return task;
    task.status = "stopping";
    task.updatedAt = this.ports.clock.now().toISOString();
    await this.ports.repository.save(task);
    await this.publish("task.stop_requested", task);
    await this.ports.process.signal(task, options);
    const timeoutMs = options.timeoutMs ?? 5_000;
    const exit = this.ports.process.waitForExit
      ? await this.ports.process.waitForExit(task, timeoutMs)
      : await this.ports.process.inspect(task);
    const exited =
      (typeof exit === "object" && exit !== null) || exit === "exited";
    if (!exited) return (await this.ports.repository.get(id)) ?? task;
    return this.finishCancelled(task, options.reason);
  }

  async restart(id: string): Promise<TaskRecord> {
    const previous = await this.require(id);
    if (!terminalStatuses.has(previous.status))
      await this.cancel(id, { reason: "restart" });
    const next = await this.start({
      name: previous.name,
      groupId: previous.groupId,
      groupName: previous.groupName,
      workerId: previous.workerId,
      projectId: previous.projectId,
      conversationId: previous.conversationId,
      agentId: previous.agentId,
      cwd: previous.cwd,
      command: previous.command,
      timeoutMs: previous.timeoutMs,
      readyUrl: previous.readiness.readyUrl,
      readyOnUrl: previous.readiness.readyOnUrl,
      readyPattern: previous.readiness.readyPattern,
      readyTimeoutMs: previous.readiness.timeoutMs,
    });
    next.restartedFromTaskId = previous.id;
    next.restartRootTaskId = previous.restartRootTaskId ?? previous.id;
    next.restartGeneration = (previous.restartGeneration ?? 0) + 1;
    await this.ports.repository.save(next);
    return next;
  }

  async reconcileOrphans(): Promise<TaskRecord[]> {
    const orphaned: TaskRecord[] = [];
    for (const task of await this.ports.repository.list()) {
      if (terminalStatuses.has(task.status)) continue;
      const evidence = await this.ports.process.inspect(task);
      if (evidence !== "exited") continue;
      task.status = "orphaned";
      task.finishedAt = this.ports.clock.now().toISOString();
      task.updatedAt = task.finishedAt;
      await this.ports.repository.save(task);
      await this.publish("task.orphaned", task);
      orphaned.push(task);
    }
    return orphaned;
  }

  async prune(): Promise<string[]> {
    const removed: string[] = [];
    for (const task of await this.ports.repository.list()) {
      if (!terminalStatuses.has(task.status)) continue;
      await this.delete(task.id);
      removed.push(task.id);
    }
    return removed;
  }

  async delete(id: string): Promise<void> {
    const task = await this.require(id);
    if (!terminalStatuses.has(task.status))
      throw new Error("Active tasks must be cancelled before deletion");
    await this.ports.logs.remove(task);
    await this.ports.repository.remove(id);
    await this.publish("task.removed", task);
  }

  private async watchReadiness(
    task: TaskRecord,
    request: StartTaskRequest,
  ): Promise<void> {
    const outcome = this.ports.readiness
      ? await this.ports.readiness.wait(task, request)
      : "unavailable";
    const current = await this.require(task.id);
    if (terminalStatuses.has(current.status)) return;
    current.readiness.outcome = outcome;
    current.updatedAt = this.ports.clock.now().toISOString();
    if (outcome === "ready") {
      current.status = "ready";
      current.readiness.readyAt = current.updatedAt;
      await this.ports.repository.save(current);
      await this.publish("task.ready", current);
      await this.ports.notifications?.notify(current, "ready");
    } else if (outcome === "timeout") {
      await this.ports.repository.save(current);
      await this.publish("task.readiness_failed", current);
    } else {
      await this.ports.repository.save(current);
    }
  }

  private async recordOutput(
    id: string,
    stream: "stdout" | "stderr",
    text: string,
  ): Promise<void> {
    const task = await this.require(id);
    const bounded = text.slice(-16_384);
    await this.ports.logs.append?.(task, stream, bounded);
    await this.ports.events.publish({
      type: "task.output",
      data: { taskId: id, stream, text: bounded },
      durability: "transient",
      occurredAt: this.ports.clock.now().toISOString(),
    });
  }

  private async recordExit(id: string, exit: TaskProcessExit): Promise<void> {
    const task = await this.require(id);
    if (terminalStatuses.has(task.status)) return;
    if (task.status === "stopping") {
      await this.finishCancelled(task);
      return;
    }
    task.exitCode = exit.exitCode ?? null;
    task.signal = exit.signal ?? null;
    task.finishedAt = exit.exitedAt;
    task.updatedAt = exit.exitedAt;
    task.status = exit.exitCode === 0 ? "completed" : "failed";
    await this.ports.repository.save(task);
    await this.publish(`task.${task.status}`, task);
    await this.ports.notifications?.notify(
      task,
      task.status === "completed" ? "completed" : "failed",
    );
  }

  private async finishCancelled(
    task: TaskRecord,
    reason?: string,
  ): Promise<TaskRecord> {
    task.status = "cancelled";
    task.error = reason;
    task.finishedAt = this.ports.clock.now().toISOString();
    task.updatedAt = task.finishedAt;
    await this.ports.repository.save(task);
    await this.publish("task.cancelled", task);
    return task;
  }

  private async watchRuntimeTimeout(
    id: string,
    timeoutMs: number,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    const task = await this.require(id);
    if (terminalStatuses.has(task.status)) return;
    task.status = "stopping";
    task.updatedAt = this.ports.clock.now().toISOString();
    await this.ports.repository.save(task);
    await this.publish("task.stop_requested", task);
    await this.ports.process.signal(task, {
      signal: "SIGTERM",
      timeoutMs: 5_000,
      reason: "runtime_timeout",
    });
    const exit = this.ports.process.waitForExit
      ? await this.ports.process.waitForExit(task, 5_000)
      : await this.ports.process.inspect(task);
    if (
      exit === "timeout" ||
      exit === "unavailable" ||
      exit === "running" ||
      exit === "unknown"
    )
      return;
    task.status = "timed_out";
    task.finishedAt = this.ports.clock.now().toISOString();
    task.updatedAt = task.finishedAt;
    await this.ports.repository.save(task);
    await this.publish("task.timed_out", task);
    await this.ports.notifications?.notify(task, "failed");
  }

  private async require(id: string): Promise<TaskRecord> {
    const task = await this.ports.repository.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }

  private publish(type: string, task: TaskRecord): Promise<void> {
    return this.ports.events.publish({
      type,
      data: { task },
      durability: "durable",
      occurredAt: this.ports.clock.now().toISOString(),
    });
  }
}

export function assertWorkspacePath(path: string, workspaceRoot: string): void {
  const normalizedRoot = workspaceRoot.replace(/[\\/]+$/, "");
  const normalizedPath = path.replace(/[\\/]+$/, "");
  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    throw new Error("Task working directory must be inside the workspace root");
  }
}
