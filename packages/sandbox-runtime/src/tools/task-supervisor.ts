import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type {
  TaskLogEvent,
  TaskLogQuery,
  TaskOrigin,
} from "@nervekit/contracts";
import { atomicWriteFile } from "../state/json-store.js";

export type SupervisedTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "orphaned";

export type SupervisedTask = {
  id: string;
  name?: string;
  groupId?: string;
  groupName?: string;
  command: string;
  cwd?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  toolCallId?: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  status: SupervisedTaskStatus;
  exitCode?: number;
  signal?: string;
  logs: string;
  logEvents: TaskLogEvent[];
  nextLogSeq: number;
  truncated?: boolean;
  maxRuntimeMs?: number;
  origin?: TaskOrigin;
  restartedFromTaskId?: string;
  restartRootTaskId?: string;
  restartGeneration?: number;
};

export type TaskScope = {
  conversationId?: string;
  agentId?: string;
  runId?: string;
  toolCallId?: string;
};

export type TaskSupervisorOptions = {
  stateDir?: string;
  maxLogBytes?: number;
  maxLogEvents?: number;
  maxTasks?: number;
  maxTaskRuntimeMs?: number;
};

export type StartSupervisedTaskOptions = {
  name?: string;
  groupId?: string;
  groupName?: string;
  origin?: TaskOrigin;
  env?: Record<string, string>;
  restartedFromTaskId?: string;
  restartRootTaskId?: string;
  restartGeneration?: number;
} & TaskScope;

export type SupervisedTaskLogQueryResponse = {
  task: SupervisedTask;
  events: TaskLogEvent[];
  nextCursor: number;
  mode: string;
  truncated?: boolean;
};

type ChildSettlement = {
  promise: Promise<void>;
  resolve: () => void;
};

export class TaskSupervisor {
  private readonly tasks = new Map<string, SupervisedTask>();
  private readonly children = new Map<
    string,
    ChildProcessByStdio<null, Readable, Readable>
  >();
  private readonly childSettlements = new Map<string, ChildSettlement>();
  private readonly pendingPersistence = new Map<string, Promise<void>>();
  private persistenceError: unknown;
  private readonly stateDir?: string;
  private readonly maxLogBytes: number;
  private readonly maxLogEvents: number;
  private readonly maxTasks: number;
  private readonly maxTaskRuntimeMs?: number;

  constructor(options: TaskSupervisorOptions | number = {}) {
    if (typeof options === "number") {
      this.maxLogBytes = options;
      this.maxLogEvents = 1_000;
      this.maxTasks = 32;
    } else {
      this.stateDir = options.stateDir;
      this.maxLogBytes = options.maxLogBytes ?? 64_000;
      this.maxLogEvents = options.maxLogEvents ?? 1_000;
      this.maxTasks = options.maxTasks ?? 32;
      this.maxTaskRuntimeMs = options.maxTaskRuntimeMs;
    }
  }

  async load(): Promise<void> {
    if (!this.stateDir) return;
    let entries: string[];
    try {
      entries = await readdir(path.join(this.stateDir, "tasks"));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      try {
        const taskDir = path.join(this.stateDir, "tasks", entry);
        const raw = JSON.parse(
          await readFile(path.join(taskDir, "state.json"), "utf8"),
        ) as Partial<SupervisedTask> & { logRef?: string };
        const logs = await readFile(
          path.join(taskDir, "logs.txt"),
          "utf8",
        ).catch(() => raw.logs ?? "");
        const now = new Date().toISOString();
        const events = normalizeLogEvents(raw.logEvents, logs);
        const maxSeq = events.reduce(
          (max, event) => Math.max(max, event.seq),
          0,
        );
        const task: SupervisedTask = {
          id: String(raw.id ?? entry),
          name: raw.name,
          groupId: raw.groupId,
          groupName: raw.groupName,
          command: String(raw.command ?? ""),
          cwd: raw.cwd,
          conversationId: raw.conversationId,
          agentId: raw.agentId,
          runId: raw.runId,
          toolCallId: raw.toolCallId,
          createdAt: raw.createdAt ?? raw.startedAt ?? now,
          startedAt: raw.startedAt ?? raw.createdAt ?? now,
          updatedAt: raw.updatedAt ?? raw.completedAt ?? raw.startedAt ?? now,
          completedAt: raw.completedAt,
          status:
            raw.status === "running" ? "orphaned" : (raw.status ?? "orphaned"),
          exitCode: raw.exitCode,
          signal: raw.signal,
          logs,
          logEvents: events,
          nextLogSeq: raw.nextLogSeq ?? maxSeq + 1,
          truncated: raw.truncated,
          maxRuntimeMs: raw.maxRuntimeMs,
          origin: raw.origin,
          restartedFromTaskId: raw.restartedFromTaskId,
          restartRootTaskId: raw.restartRootTaskId,
          restartGeneration: raw.restartGeneration,
        };
        if (!task.completedAt && task.status === "orphaned")
          task.completedAt = now;
        task.updatedAt = now;
        this.tasks.set(task.id, task);
        await this.persist(task);
      } catch {
        // Ignore corrupt task records; state recovery must not block daemon startup.
      }
    }
  }

  start(
    command: string,
    cwd = "/workspace",
    timeoutMs?: number,
    options: StartSupervisedTaskOptions = {},
  ): SupervisedTask {
    const active = Array.from(this.tasks.values()).filter(isActiveTask).length;
    if (active >= this.maxTasks)
      throw new Error(
        `maximum supervised task count exceeded: ${this.maxTasks}`,
      );
    const maxRuntime = clampTimeout(timeoutMs, this.maxTaskRuntimeMs);
    const now = new Date().toISOString();
    const task: SupervisedTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: options.name,
      groupId: options.groupId,
      groupName: options.groupName,
      command,
      cwd,
      conversationId: options.conversationId,
      agentId: options.agentId,
      runId: options.runId,
      toolCallId: options.toolCallId,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      status: "running",
      logs: "",
      logEvents: [],
      nextLogSeq: 1,
      maxRuntimeMs: maxRuntime,
      origin: options.origin ?? defaultOrigin(options),
      restartedFromTaskId: options.restartedFromTaskId,
      restartRootTaskId: options.restartRootTaskId,
      restartGeneration: options.restartGeneration,
    };
    this.tasks.set(task.id, task);
    this.schedulePersist(task);
    const [shell, args] = shellCommand(command);
    const child = spawn(shell, args, {
      cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.set(task.id, child);
    this.trackChildSettlement(task.id);
    const append = (stream: "stdout" | "stderr", chunk: unknown) => {
      appendLog(
        task,
        stream,
        String(chunk),
        this.maxLogBytes,
        this.maxLogEvents,
      );
      this.schedulePersist(task);
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    let timer: NodeJS.Timeout | undefined;
    if (maxRuntime) timer = setTimeout(() => child.kill("SIGTERM"), maxRuntime);
    let settled = false;
    const finish = (apply: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      apply();
      task.updatedAt = new Date().toISOString();
      this.children.delete(task.id);
      this.schedulePersist(task);
      this.resolveChildSettlement(task.id);
    };
    child.on("error", (error) => {
      finish(() => {
        task.completedAt = new Date().toISOString();
        task.exitCode = 127;
        task.status = "failed";
        appendLog(
          task,
          "stderr",
          error instanceof Error ? error.message : String(error),
          this.maxLogBytes,
          this.maxLogEvents,
        );
      });
    });
    child.on("close", (code, signal) => {
      finish(() => {
        task.completedAt = new Date().toISOString();
        task.exitCode = code ?? undefined;
        task.signal = signal ?? undefined;
        if (task.status !== "cancelled")
          task.status = code === 0 ? "completed" : "failed";
      });
    });
    return task;
  }

  cancel(
    id: string,
    signal: NodeJS.Signals = "SIGTERM",
  ): SupervisedTask | undefined {
    const task = this.tasks.get(id);
    const child = this.children.get(id);
    if (!task) return undefined;
    if (isActiveTask(task)) {
      task.status = "cancelled";
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;
      task.signal = signal;
      child?.kill(signal);
    }
    if (!child) this.children.delete(id);
    this.schedulePersist(task);
    return task;
  }

  async cancelRun(
    scope: { conversationId: string; agentId: string; runId: string },
    signal: NodeJS.Signals = "SIGTERM",
  ): Promise<SupervisedTask[]> {
    const cancelled: SupervisedTask[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.status === "running" &&
        task.conversationId === scope.conversationId &&
        task.agentId === scope.agentId &&
        task.runId === scope.runId
      ) {
        const next = this.cancel(task.id, signal);
        if (next) {
          await this.flushPersistence(next.id);
          cancelled.push(next);
        }
      }
    }
    return cancelled;
  }

  restart(
    id: string,
    cwd?: string,
    timeoutMs?: number,
  ): SupervisedTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return this.start(
      task.command,
      cwd ?? task.cwd ?? "/workspace",
      timeoutMs ?? task.maxRuntimeMs,
      {
        name: task.name,
        groupId: task.groupId,
        groupName: task.groupName,
        conversationId: task.conversationId,
        agentId: task.agentId,
        runId: task.runId,
        toolCallId: task.toolCallId,
        origin: task.origin,
        restartedFromTaskId: task.id,
        restartRootTaskId:
          task.restartRootTaskId ?? task.restartedFromTaskId ?? task.id,
        restartGeneration: (task.restartGeneration ?? 0) + 1,
      },
    );
  }

  list(): SupervisedTask[] {
    return Array.from(this.tasks.values()).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  get(id: string): SupervisedTask | undefined {
    return this.tasks.get(id);
  }

  logs(
    id: string,
    cursor = 0,
    limit = 16_000,
  ): { content: string; cursor: number; truncated?: boolean } | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const content = task.logs.slice(cursor, cursor + limit);
    return {
      content,
      cursor: cursor + content.length,
      truncated: task.truncated,
    };
  }

  queryLogs(
    id: string,
    query: TaskLogQuery = {},
  ): SupervisedTaskLogQueryResponse | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const mode = query.mode ?? "recent";
    const limit = query.limit ?? 120;
    let events = task.logEvents;
    if (mode === "since_cursor") {
      events = events.filter((event) => event.seq > (query.sinceSeq ?? 0));
    } else if (mode === "errors") {
      events = events.filter((event) => event.level === "error");
    } else if (mode === "warnings") {
      events = events.filter((event) => event.level === "warn");
    } else if (mode === "first_failure") {
      const first = events.findIndex((event) => event.level === "error");
      if (first >= 0) {
        const context = query.contextLines ?? 3;
        events = events.slice(
          Math.max(0, first - context),
          first + context + 1,
        );
      } else {
        events = [];
      }
    }
    if (query.contains) {
      events = events.filter((event) =>
        event.line.includes(query.contains ?? ""),
      );
    }
    if (query.regex) {
      try {
        const regex = new RegExp(query.regex);
        events = events.filter((event) => regex.test(event.line));
      } catch {
        events = [];
      }
    }
    if (mode === "recent") events = events.slice(-limit);
    else events = events.slice(0, limit);
    const nextCursor = task.logEvents.reduce(
      (max, event) => Math.max(max, event.seq),
      0,
    );
    return { task, events, nextCursor, mode, truncated: task.truncated };
  }

  async flushPersistence(id?: string): Promise<void> {
    while (true) {
      const pendingWrites = id
        ? [this.pendingPersistence.get(id)].filter(
            (pending): pending is Promise<void> => Boolean(pending),
          )
        : Array.from(this.pendingPersistence.values());
      if (pendingWrites.length === 0) break;
      await Promise.all(pendingWrites);
    }
    if (this.persistenceError) throw this.persistenceError;
  }

  async drain(
    options: { waitForChildren?: boolean; childTimeoutMs?: number } = {},
  ): Promise<void> {
    if (options.waitForChildren ?? true) {
      await this.waitForChildSettlements(
        undefined,
        options.childTimeoutMs ?? 2000,
      );
    }
    await this.flushPersistence();
  }

  async delete(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (isActiveTask(task)) throw new Error("Cannot delete an active task");
    await this.waitForChildSettlements([id], 2000);
    await this.flushPersistence(id);
    this.tasks.delete(id);
    this.children.delete(id);
    if (this.stateDir) {
      await rm(path.join(this.stateDir, "tasks", id), {
        recursive: true,
        force: true,
      });
    }
    return true;
  }

  async prune(): Promise<string[]> {
    const removed: string[] = [];
    for (const task of this.list()) {
      if (isActiveTask(task)) continue;
      if (await this.delete(task.id)) removed.push(task.id);
    }
    return removed;
  }

  private schedulePersist(task: SupervisedTask): void {
    if (!this.stateDir) return;
    const snapshot = snapshotTask(task);
    const previous = this.pendingPersistence.get(task.id) ?? Promise.resolve();
    const write = previous.then(() => this.persist(snapshot));
    const handled = write.catch((error) => {
      if (!this.persistenceError) this.persistenceError = error;
    });
    const tracked = handled.finally(() => {
      if (this.pendingPersistence.get(task.id) === tracked) {
        this.pendingPersistence.delete(task.id);
      }
    });
    this.pendingPersistence.set(task.id, tracked);
  }

  private trackChildSettlement(id: string): void {
    if (this.childSettlements.has(id)) return;
    let resolve!: () => void;
    const promise = new Promise<void>((settled) => {
      resolve = settled;
    });
    this.childSettlements.set(id, { promise, resolve });
  }

  private resolveChildSettlement(id: string): void {
    const settlement = this.childSettlements.get(id);
    if (!settlement) return;
    this.childSettlements.delete(id);
    settlement.resolve();
  }

  private async waitForChildSettlements(
    ids: string[] | undefined,
    timeoutMs: number,
  ): Promise<void> {
    const settlements = Array.from(this.childSettlements.entries()).filter(
      ([id]) => !ids || ids.includes(id),
    );
    if (settlements.length === 0) return;
    let timedOut = false;
    await Promise.race([
      Promise.all(settlements.map(([, settlement]) => settlement.promise)),
      delay(Math.max(0, timeoutMs)).then(() => {
        timedOut = true;
      }),
    ]);
    if (!timedOut) return;
    const pendingIds = settlements
      .map(([id]) => id)
      .filter((id) => this.childSettlements.has(id));
    if (pendingIds.length === 0) return;
    throw new Error(
      `Timed out waiting for supervised task children to settle: ${pendingIds.join(", ")}`,
    );
  }

  private async persist(task: SupervisedTask): Promise<void> {
    if (!this.stateDir) return;
    const dir = path.join(this.stateDir, "tasks", task.id);
    const summary = { ...task };
    Reflect.deleteProperty(summary, "logs");
    await atomicWriteFile(
      path.join(dir, "state.json"),
      `${JSON.stringify({ ...summary, logRef: `task://${task.id}/logs` }, null, 2)}\n`,
    );
    await atomicWriteFile(path.join(dir, "logs.txt"), task.logs);
  }
}

function snapshotTask(task: SupervisedTask): SupervisedTask {
  return {
    ...task,
    logEvents: task.logEvents.map((event) => ({ ...event })),
    origin: task.origin ? { ...task.origin } : undefined,
  };
}

function appendLog(
  task: SupervisedTask,
  stream: "stdout" | "stderr",
  text: string,
  maxLogBytes: number,
  maxLogEvents: number,
): void {
  task.logs += text;
  if (Buffer.byteLength(task.logs) > maxLogBytes) {
    task.logs = task.logs.slice(-maxLogBytes);
    task.truncated = true;
  }
  const ts = new Date().toISOString();
  const lines = splitLogLines(text);
  for (const line of lines) {
    task.logEvents.push({
      seq: task.nextLogSeq++,
      ts,
      stream,
      level: stream === "stderr" ? "error" : "info",
      line,
    });
  }
  if (task.logEvents.length > maxLogEvents) {
    task.logEvents.splice(0, task.logEvents.length - maxLogEvents);
    task.truncated = true;
  }
  task.updatedAt = ts;
}

function splitLogLines(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length > 0) return lines;
  return text.length > 0 ? [text] : [];
}

function normalizeLogEvents(
  events: TaskLogEvent[] | undefined,
  logs: string,
): TaskLogEvent[] {
  if (Array.isArray(events) && events.length > 0) return events;
  const now = new Date().toISOString();
  return splitLogLines(logs).map((line, index) => ({
    seq: index + 1,
    ts: now,
    stream: "stdout" as const,
    level: "info" as const,
    line,
  }));
}

function defaultOrigin(options: StartSupervisedTaskOptions): TaskOrigin {
  if (options.toolCallId?.startsWith("tool_")) {
    return {
      kind: "agent_tool",
      toolCallId: options.toolCallId,
      runId: options.runId?.startsWith("run_") ? options.runId : undefined,
    };
  }
  return { kind: "api" };
}

function isActiveTask(task: SupervisedTask): boolean {
  return task.status === "running";
}

function shellCommand(command: string): [string, string[]] {
  if (process.platform === "win32") return ["bash", ["-lc", command]];
  return ["/bin/sh", ["-lc", command]];
}

function clampTimeout(
  timeoutMs: number | undefined,
  maxTaskRuntimeMs: number | undefined,
): number | undefined {
  if (timeoutMs && maxTaskRuntimeMs)
    return Math.min(timeoutMs, maxTaskRuntimeMs);
  return timeoutMs ?? maxTaskRuntimeMs;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
