import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  TaskService,
  type DomainEventIntent,
  type TaskProcessCallbacks,
  type TaskProcessExit,
  type TaskProcessPort,
  type TaskRepositoryPort,
  type TaskStartInput,
} from "@nervekit/host-runtime";
import {
  createId,
  taskRecordSchema,
  type TaskLogEvent,
  type TaskLogQuery,
  type TaskLogQueryResponse,
  type TaskRecord,
} from "@nervekit/contracts";
import type { EventOutbox } from "../state/event-outbox.js";
import { atomicWriteFile } from "../state/json-store.js";

export type SandboxTaskServiceOptions = {
  stateDir: string;
  workspaceDir: string;
  events: EventOutbox;
  maxLogBytes?: number;
  maxLogEvents?: number;
  maxTasks?: number;
  maxTaskRuntimeMs?: number;
};

type StoredLogs = {
  text: string;
  events: TaskLogEvent[];
  nextSeq: number;
  truncated: boolean;
};

type ChildState = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  settled: Promise<TaskProcessExit>;
  exit?: TaskProcessExit;
};

class SandboxTaskAdapter implements TaskRepositoryPort, TaskProcessPort {
  private readonly records = new Map<string, TaskRecord>();
  private readonly taskLogs = new Map<string, StoredLogs>();
  private readonly children = new Map<string, ChildState>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly maxLogBytes: number;
  private readonly maxLogEvents: number;

  constructor(private readonly options: SandboxTaskServiceOptions) {
    this.maxLogBytes = options.maxLogBytes ?? 64_000;
    this.maxLogEvents = options.maxLogEvents ?? 1_000;
  }

  async load(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(path.join(this.options.stateDir, "tasks"));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      try {
        const dir = path.join(this.options.stateDir, "tasks", entry);
        const raw = JSON.parse(
          await readFile(path.join(dir, "state.json"), "utf8"),
        ) as Record<string, unknown>;
        const task = taskRecordSchema.parse(raw.task ?? raw);
        const text = await readFile(path.join(dir, "logs.txt"), "utf8").catch(
          () => "",
        );
        const events = Array.isArray(raw.logEvents)
          ? (raw.logEvents as TaskLogEvent[])
          : logEventsFromText(text);
        this.records.set(task.id, task);
        this.taskLogs.set(task.id, {
          text,
          events,
          nextSeq: Math.max(0, ...events.map((event) => event.seq)) + 1,
          truncated: raw.truncated === true,
        });
      } catch {
        // Corrupt records are isolated and must not prevent daemon startup.
      }
    }
  }

  get(id: string): Promise<TaskRecord | undefined> {
    const task = this.records.get(id);
    return Promise.resolve(task ? structuredClone(task) : undefined);
  }

  list(): Promise<TaskRecord[]> {
    return Promise.resolve(
      [...this.records.values()].map((task) => structuredClone(task)),
    );
  }

  async save(task: TaskRecord): Promise<void> {
    this.records.set(task.id, structuredClone(task));
    await this.persist(task.id);
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
    this.taskLogs.delete(id);
    await rm(path.join(this.options.stateDir, "tasks", id), {
      recursive: true,
      force: true,
    });
  }

  paths(taskId: string) {
    const dir = path.join(this.options.stateDir, "tasks", taskId);
    return {
      stdoutPath: path.join(dir, "stdout.log"),
      stderrPath: path.join(dir, "stderr.log"),
      combinedPath: path.join(dir, "logs.txt"),
      logsPath: path.join(dir, "logs.jsonl"),
    };
  }

  async append(
    task: TaskRecord,
    stream: "stdout" | "stderr",
    text: string,
  ): Promise<void> {
    const logs = this.logsFor(task.id);
    logs.text += text;
    if (Buffer.byteLength(logs.text) > this.maxLogBytes) {
      logs.text = logs.text.slice(-this.maxLogBytes);
      logs.truncated = true;
    }
    const ts = new Date().toISOString();
    for (const line of splitLogLines(text)) {
      logs.events.push({
        seq: logs.nextSeq++,
        ts,
        stream,
        level: stream === "stderr" ? "error" : "info",
        line,
      });
    }
    if (logs.events.length > this.maxLogEvents) {
      logs.events.splice(0, logs.events.length - this.maxLogEvents);
      logs.truncated = true;
    }
    await this.persist(task.id);
  }

  async query(
    task: TaskRecord,
    query: TaskLogQuery,
  ): Promise<TaskLogQueryResponse> {
    const logs = this.logsFor(task.id);
    const mode = query.mode ?? "recent";
    const limit = query.limit ?? 120;
    let events = logs.events;
    if (mode === "since_cursor")
      events = events.filter((event) => event.seq > (query.sinceSeq ?? 0));
    else if (mode === "errors")
      events = events.filter((event) => event.level === "error");
    else if (mode === "warnings")
      events = events.filter((event) => event.level === "warn");
    else if (mode === "first_failure") {
      const first = events.findIndex((event) => event.level === "error");
      const context = query.contextLines ?? 3;
      events =
        first < 0
          ? []
          : events.slice(Math.max(0, first - context), first + context + 1);
    }
    if (query.contains)
      events = events.filter((event) => event.line.includes(query.contains!));
    if (query.regex) {
      try {
        const regex = new RegExp(query.regex);
        events = events.filter((event) => regex.test(event.line));
      } catch {
        events = [];
      }
    }
    events = mode === "recent" ? events.slice(-limit) : events.slice(0, limit);
    return {
      task,
      events: events.map((event) => ({ ...event })),
      nextCursor: Math.max(0, ...logs.events.map((event) => event.seq)),
      mode,
      previewPath: task.combinedPath,
      truncated: logs.truncated,
    };
  }

  removeLogs(task: TaskRecord): Promise<void> {
    this.taskLogs.delete(task.id);
    return Promise.resolve();
  }

  // TaskLogPort and TaskRepositoryPort both name their cleanup operation remove.
  // Repository cleanup above also removes logs, so one implementation serves both.

  async spawn(
    input: TaskStartInput & { taskId: string },
    callbacks: TaskProcessCallbacks = {},
  ): Promise<TaskRecord["runtime"]> {
    if (this.children.size >= (this.options.maxTasks ?? 32))
      throw new Error(
        `maximum supervised task count exceeded: ${this.options.maxTasks ?? 32}`,
      );
    const [shell, args] = shellCommand(input.command);
    const child = spawn(shell, args, {
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settle!: (exit: TaskProcessExit) => void;
    const settled = new Promise<TaskProcessExit>(
      (resolve) => (settle = resolve),
    );
    const state: ChildState = { child, settled };
    this.children.set(input.taskId, state);
    child.stdout.on(
      "data",
      (chunk) => void callbacks.onOutput?.("stdout", String(chunk)),
    );
    child.stderr.on(
      "data",
      (chunk) => void callbacks.onOutput?.("stderr", String(chunk)),
    );
    let finished = false;
    const finish = (exit: TaskProcessExit) => {
      if (finished) return;
      finished = true;
      state.exit = exit;
      this.children.delete(input.taskId);
      settle(exit);
      void callbacks.onExit?.(exit);
    };
    child.on("error", (error) => {
      void callbacks.onOutput?.(
        "stderr",
        error instanceof Error ? error.message : String(error),
      );
      finish({ exitCode: 127, exitedAt: new Date().toISOString() });
    });
    child.on("close", (code, signal) =>
      finish({
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        exitedAt: new Date().toISOString(),
      }),
    );
    return {
      platform: process.platform,
      childPid: child.pid,
      processGroupId: child.pid,
      detached: false,
      shell: true,
      spawnedAt: new Date().toISOString(),
    };
  }

  async signal(
    task: TaskRecord,
    options: { signal?: "SIGTERM" | "SIGINT" | "SIGKILL" },
  ): Promise<void> {
    const child = this.children.get(task.id)?.child;
    if (child && !child.killed) child.kill(options.signal ?? "SIGTERM");
  }

  async inspect(task: TaskRecord): Promise<"running" | "exited" | "unknown"> {
    if (this.children.has(task.id)) return "running";
    const pid = task.runtime?.childPid;
    if (!pid) return "exited";
    try {
      process.kill(pid, 0);
      return "running";
    } catch (error) {
      return isMissingProcess(error) ? "exited" : "unknown";
    }
  }

  async waitForExit(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<TaskProcessExit | "timeout" | "unavailable"> {
    const state = this.children.get(task.id);
    if (!state) {
      const evidence = await this.inspect(task);
      return evidence === "exited"
        ? { exitedAt: new Date().toISOString() }
        : "unavailable";
    }
    return Promise.race([
      state.settled,
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs),
      ),
    ]);
  }

  async drain(timeoutMs = 2_000): Promise<void> {
    const settlements = [...this.children.values()].map(
      (state) => state.settled,
    );
    if (settlements.length) {
      await Promise.race([
        Promise.all(settlements),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    }
    await Promise.all(this.writes.values());
  }

  private logsFor(id: string): StoredLogs {
    let logs = this.taskLogs.get(id);
    if (!logs) {
      logs = { text: "", events: [], nextSeq: 1, truncated: false };
      this.taskLogs.set(id, logs);
    }
    return logs;
  }

  private async persist(id: string): Promise<void> {
    const task = this.records.get(id);
    if (!task) return;
    const logs = this.logsFor(id);
    const previous = this.writes.get(id) ?? Promise.resolve();
    const write = previous.then(async () => {
      const dir = path.join(this.options.stateDir, "tasks", id);
      await atomicWriteFile(
        path.join(dir, "state.json"),
        `${JSON.stringify(
          {
            task,
            logEvents: logs.events,
            truncated: logs.truncated,
            logRef: `task://${id}/logs`,
          },
          null,
          2,
        )}\n`,
      );
      await atomicWriteFile(path.join(dir, "logs.txt"), logs.text);
    });
    this.writes.set(id, write);
    try {
      await write;
    } finally {
      if (this.writes.get(id) === write) this.writes.delete(id);
    }
  }
}

export class SandboxTaskService {
  readonly service: TaskService;
  private readonly adapter: SandboxTaskAdapter;
  private readonly maxTaskRuntimeMs?: number;

  constructor(private readonly options: SandboxTaskServiceOptions) {
    this.adapter = new SandboxTaskAdapter(options);
    this.maxTaskRuntimeMs = options.maxTaskRuntimeMs;
    this.service = new TaskService({
      repository: this.adapter,
      process: this.adapter,
      logs: {
        paths: (id) => this.adapter.paths(id),
        append: (task, stream, text) => this.adapter.append(task, stream, text),
        query: (task, query) => this.adapter.query(task, query),
        remove: (task) => this.adapter.removeLogs(task),
      },
      events: {
        publish: (event) => this.publish(event),
      },
      clock: { now: () => new Date() },
      ids: { next: () => createId("task") },
      workspaceRoot: options.workspaceDir,
    });
  }

  async load(): Promise<void> {
    await this.adapter.load();
    await this.service.reconcileOrphans();
  }

  start(input: TaskStartInput): Promise<TaskRecord> {
    const timeoutMs = clampTimeout(input.timeoutMs, this.maxTaskRuntimeMs);
    return this.service.start({ ...input, timeoutMs });
  }

  get(id: string): Promise<TaskRecord | undefined> {
    return this.service.get(id);
  }

  list(): Promise<TaskRecord[]> {
    return this.service.list();
  }

  logs(id: string, query: TaskLogQuery = {}): Promise<TaskLogQueryResponse> {
    return this.service.logs(id, query);
  }

  cancel(id: string, signal: "SIGTERM" | "SIGINT" | "SIGKILL" = "SIGTERM") {
    return this.service.cancel(id, { signal });
  }

  restart(id: string) {
    return this.service.restart(id);
  }

  prune() {
    return this.service.prune();
  }

  async delete(id: string): Promise<boolean> {
    if (!(await this.service.get(id))) return false;
    await this.service.delete(id);
    return true;
  }

  async cancelRun(scope: {
    conversationId: string;
    agentId: string;
    runId: string;
  }) {
    const cancelled: TaskRecord[] = [];
    for (const task of await this.service.list({
      conversationId: scope.conversationId,
      agentId: scope.agentId,
    })) {
      if (
        !isActive(task) ||
        task.origin.kind !== "agent_tool" ||
        task.origin.runId !== scope.runId
      )
        continue;
      cancelled.push(await this.service.cancel(task.id));
    }
    return cancelled;
  }

  drain(options: { childTimeoutMs?: number } = {}): Promise<void> {
    return this.adapter.drain(options.childTimeoutMs);
  }

  private async publish(event: DomainEventIntent): Promise<void> {
    const data = event.data as { task?: TaskRecord };
    const task = data.task;
    await this.options.events.append({
      type: event.type,
      durability: event.durability,
      data: event.data,
      conversationId: task?.conversationId,
      agentId: task?.agentId,
      runId: task?.origin.kind === "agent_tool" ? task.origin.runId : undefined,
      ts: event.occurredAt,
    });
  }
}

function isActive(task: TaskRecord): boolean {
  return ["starting", "running", "ready", "stopping"].includes(task.status);
}

function shellCommand(command: string): [string, string[]] {
  return process.platform === "win32"
    ? ["bash", ["-lc", command]]
    : ["/bin/sh", ["-lc", command]];
}

function splitLogLines(text: string): string[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.length ? lines : text ? [text] : [];
}

function logEventsFromText(text: string): TaskLogEvent[] {
  const ts = new Date().toISOString();
  return splitLogLines(text).map((line, index) => ({
    seq: index + 1,
    ts,
    stream: "stdout",
    level: "info",
    line,
  }));
}

function clampTimeout(value?: number, maximum?: number): number | undefined {
  return value && maximum ? Math.min(value, maximum) : (value ?? maximum);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ESRCH"
  );
}
