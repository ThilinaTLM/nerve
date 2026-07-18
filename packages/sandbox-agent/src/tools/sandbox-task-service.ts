import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  queryTaskLogEvents,
  TaskService,
  type DiagnosticPort,
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
import {
  delay,
  inspectSandboxRuntime,
  linuxDescendantPids,
  signalSandboxRuntime,
} from "./sandbox-task-process.js";

export type SandboxTaskServiceOptions = {
  stateDir: string;
  workspaceDir: string;
  events: EventOutbox;
  maxLogBytes?: number;
  maxLogEvents?: number;
  maxTasks?: number;
  maxTaskRuntimeMs?: number;
  diagnostics?: DiagnosticPort;
};

type StoredLogs = {
  text: string;
  events: TaskLogEvent[];
  nextSeq: number;
  truncated: boolean;
};

type ChildState = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  runtime: NonNullable<TaskRecord["runtime"]>;
  settled: Promise<TaskProcessExit>;
  stopping: boolean;
  knownDescendants: Set<number>;
  exit?: TaskProcessExit;
};

class SandboxTaskAdapter implements TaskRepositoryPort, TaskProcessPort {
  private readonly records = new Map<string, TaskRecord>();
  private readonly taskLogs = new Map<string, StoredLogs>();
  private readonly children = new Map<string, ChildState>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly persistedDescendants = new Map<string, Set<number>>();
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
    this.persistedDescendants.delete(id);
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
    const page = queryTaskLogEvents(logs.events, {
      limit: 120,
      ...query,
    });
    return {
      task,
      ...page,
      events: page.events.map((event) => ({ ...event })),
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
    const detached = process.platform !== "win32";
    const child = spawn(shell, args, {
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } : process.env,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settle!: (exit: TaskProcessExit) => void;
    const settled = new Promise<TaskProcessExit>(
      (resolve) => (settle = resolve),
    );
    const runtime: NonNullable<TaskRecord["runtime"]> = {
      platform: process.platform,
      childPid: child.pid,
      processGroupId: detached ? child.pid : undefined,
      detached,
      shell: true,
      spawnedAt: new Date().toISOString(),
    };
    const state: ChildState = {
      child,
      runtime,
      settled,
      stopping: false,
      knownDescendants: new Set<number>(),
    };
    this.children.set(input.taskId, state);
    child.stdout.on("data", (chunk) =>
      this.observeCallback(
        callbacks.onOutput?.("stdout", String(chunk)),
        input.taskId,
        "output",
      ),
    );
    child.stderr.on("data", (chunk) =>
      this.observeCallback(
        callbacks.onOutput?.("stderr", String(chunk)),
        input.taskId,
        "output",
      ),
    );
    let finished = false;
    const finish = async (exit: TaskProcessExit) => {
      if (finished) return;
      finished = true;
      state.exit = exit;
      if (state.stopping)
        await this.waitForRuntimeExit(state.runtime, state.knownDescendants);
      try {
        await callbacks.onExit?.(exit);
      } finally {
        this.children.delete(input.taskId);
        settle(exit);
      }
    };
    child.on("error", (error) => {
      this.observeCallback(
        callbacks.onOutput?.(
          "stderr",
          error instanceof Error ? error.message : String(error),
        ),
        input.taskId,
        "spawn_error_output",
      );
      this.observeCallback(
        finish({ exitCode: 127, exitedAt: new Date().toISOString() }),
        input.taskId,
        "exit",
      );
    });
    child.on("close", (code, signal) =>
      this.observeCallback(
        finish({
          exitCode: code ?? undefined,
          signal: signal ?? undefined,
          exitedAt: new Date().toISOString(),
        }),
        input.taskId,
        "exit",
      ),
    );
    return runtime;
  }

  async signal(
    task: TaskRecord,
    options: { signal?: "SIGTERM" | "SIGINT" | "SIGKILL" },
  ): Promise<void> {
    const state = this.children.get(task.id);
    if (state) state.stopping = true;
    const knownDescendants =
      state?.knownDescendants ?? this.descendantsFor(task.id);
    for (const pid of linuxDescendantPids(
      (state?.runtime ?? task.runtime)?.childPid,
    ))
      knownDescendants.add(pid);
    await signalSandboxRuntime(
      state?.runtime ?? task.runtime,
      options.signal ?? "SIGTERM",
      knownDescendants,
      state?.child,
    );
  }

  async inspect(
    task: TaskRecord,
  ): Promise<"running" | "unsupervised_running" | "exited" | "unknown"> {
    if (this.children.has(task.id)) return "running";
    const evidence = inspectSandboxRuntime(
      task.runtime,
      this.persistedDescendants.get(task.id),
    );
    return evidence === "running" ? "unsupervised_running" : evidence;
  }

  async waitForExit(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<TaskProcessExit | "timeout" | "unavailable"> {
    const state = this.children.get(task.id);
    if (!state) return this.waitForPersistedRuntimeExit(task, timeoutMs);
    return new Promise<TaskProcessExit | "timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), timeoutMs);
      void state.settled.then((exit) => {
        clearTimeout(timer);
        resolve(exit);
      });
    });
  }

  async saveLaunchConfig(
    taskId: string,
    env: Record<string, string> | undefined,
  ): Promise<void> {
    if (!env) return;
    await atomicWriteFile(
      path.join(this.options.stateDir, "tasks", taskId, "launch.json"),
      `${JSON.stringify({ version: 1, env })}\n`,
      0o600,
    );
  }

  async loadLaunchConfig(
    task: TaskRecord,
  ): Promise<Record<string, string> | undefined> {
    if (!task.envInfo?.persisted) return undefined;
    const file = path.join(
      this.options.stateDir,
      "tasks",
      task.id,
      "launch.json",
    );
    let value: unknown;
    try {
      value = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (isNotFound(error))
        throw new Error("Task launch environment is unavailable", {
          cause: error,
        });
      throw error;
    }
    const env = (value as { env?: unknown }).env;
    if (!env || typeof env !== "object" || Array.isArray(env))
      throw new Error("Task launch environment is invalid");
    const entries = Object.entries(env);
    if (entries.some((entry) => typeof entry[1] !== "string"))
      throw new Error("Task launch environment is invalid");
    return Object.fromEntries(entries) as Record<string, string>;
  }

  async removeLaunchConfig(task: TaskRecord): Promise<void> {
    await rm(
      path.join(this.options.stateDir, "tasks", task.id, "launch.json"),
      { force: true },
    );
  }

  private async waitForPersistedRuntimeExit(
    task: TaskRecord,
    timeoutMs: number,
  ): Promise<TaskProcessExit | "timeout" | "unavailable"> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const evidence = inspectSandboxRuntime(
        task.runtime,
        this.persistedDescendants.get(task.id),
      );
      if (evidence === "exited") return { exitedAt: new Date().toISOString() };
      if (evidence === "unknown") return "unavailable";
      await delay(Math.min(20, Math.max(1, deadline - Date.now())));
    }
    return "timeout";
  }

  private async waitForRuntimeExit(
    runtime: TaskRecord["runtime"],
    descendants: ReadonlySet<number>,
  ): Promise<void> {
    while (inspectSandboxRuntime(runtime, descendants) === "running")
      await delay(20);
  }

  private descendantsFor(taskId: string): Set<number> {
    let descendants = this.persistedDescendants.get(taskId);
    if (!descendants) {
      descendants = new Set<number>();
      this.persistedDescendants.set(taskId, descendants);
    }
    return descendants;
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

  private observeCallback(
    result: void | Promise<void> | undefined,
    taskId: string,
    kind: string,
  ): void {
    if (!result) return;
    void result.catch((error) => {
      try {
        this.options.diagnostics?.error("Sandbox task callback failed", {
          taskId,
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Diagnostics must not cause an unhandled callback rejection.
      }
    });
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
      launchConfigs: {
        save: (taskId, env) => this.adapter.saveLaunchConfig(taskId, env),
        load: (task) => this.adapter.loadLaunchConfig(task),
        remove: (task) => this.adapter.removeLaunchConfig(task),
      },
      clock: { now: () => new Date() },
      ids: { next: () => createId("task") },
      workspaceRoot: options.workspaceDir,
      diagnostics: options.diagnostics,
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

  async drain(options: { childTimeoutMs?: number } = {}): Promise<void> {
    await this.adapter.drain(options.childTimeoutMs);
    await this.options.events.drain();
  }

  private async publish(event: DomainEventIntent): Promise<void> {
    const data = event.data as { task?: TaskRecord };
    const task = data.task;
    await this.options.events.append({
      type: event.type,
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
