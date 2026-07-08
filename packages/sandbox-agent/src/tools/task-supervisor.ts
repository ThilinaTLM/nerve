import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { TaskLogEvent, TaskLogQuery, TaskOrigin } from "@nervekit/shared";

export type SupervisedTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "orphaned";

export type SupervisedTask = {
  id: string;
  name?: string;
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

export class TaskSupervisor {
  private readonly tasks = new Map<string, SupervisedTask>();
  private readonly children = new Map<
    string,
    ChildProcessByStdio<null, Readable, Readable>
  >();
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
    let entries: string[] = [];
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
    void this.persist(task);
    const [shell, args] = shellCommand(command);
    const child = spawn(shell, args, {
      cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (stream: "stdout" | "stderr", chunk: unknown) => {
      appendLog(
        task,
        stream,
        String(chunk),
        this.maxLogBytes,
        this.maxLogEvents,
      );
      void this.persist(task);
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
      void this.persist(task);
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
    this.children.set(task.id, child);
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
    this.children.delete(id);
    void this.persist(task);
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
          await this.persist(next);
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

  async delete(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (isActiveTask(task)) throw new Error("Cannot delete an active task");
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

  private async persist(task: SupervisedTask): Promise<void> {
    if (!this.stateDir) return;
    const dir = path.join(this.stateDir, "tasks", task.id);
    await mkdir(dir, { recursive: true });
    const { logs: _logs, ...summary } = task;
    await writeFile(
      path.join(dir, "state.json"),
      JSON.stringify({ ...summary, logRef: `task://${task.id}/logs` }, null, 2),
    );
    await writeFile(path.join(dir, "logs.txt"), task.logs);
  }
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
