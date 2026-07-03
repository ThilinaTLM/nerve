import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

export type SupervisedTask = {
  id: string;
  name?: string;
  command: string;
  cwd?: string;
  conversationId?: string;
  agentId?: string;
  runId?: string;
  toolCallId?: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "orphaned";
  exitCode?: number;
  logs: string;
  truncated?: boolean;
  maxRuntimeMs?: number;
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
  maxTasks?: number;
  maxTaskRuntimeMs?: number;
};

export class TaskSupervisor {
  private readonly tasks = new Map<string, SupervisedTask>();
  private readonly children = new Map<
    string,
    ChildProcessByStdio<null, Readable, Readable>
  >();
  private readonly stateDir?: string;
  private readonly maxLogBytes: number;
  private readonly maxTasks: number;
  private readonly maxTaskRuntimeMs?: number;

  constructor(options: TaskSupervisorOptions | number = {}) {
    if (typeof options === "number") {
      this.maxLogBytes = options;
      this.maxTasks = 32;
    } else {
      this.stateDir = options.stateDir;
      this.maxLogBytes = options.maxLogBytes ?? 64_000;
      this.maxTasks = options.maxTasks ?? 32;
      this.maxTaskRuntimeMs = options.maxTaskRuntimeMs;
    }
  }

  async load(): Promise<void> {
    if (!this.stateDir) return;
    let entries: string[] = [];
    try {
      if (!this.stateDir) return;
      entries = await readdir(path.join(this.stateDir, "tasks"));
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
        return;
      throw error;
    }
    for (const entry of entries) {
      try {
        const task = JSON.parse(
          await readFile(
            path.join(this.stateDir, "tasks", entry, "state.json"),
            "utf8",
          ),
        ) as SupervisedTask;
        if (task.status === "running") task.status = "orphaned";
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
    options: { name?: string } & TaskScope = {},
  ): SupervisedTask {
    const active = Array.from(this.tasks.values()).filter(
      (task) => task.status === "running",
    ).length;
    if (active >= this.maxTasks)
      throw new Error(
        `maximum supervised task count exceeded: ${this.maxTasks}`,
      );
    const maxRuntime = clampTimeout(timeoutMs, this.maxTaskRuntimeMs);
    const task: SupervisedTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: options.name,
      command,
      cwd,
      conversationId: options.conversationId,
      agentId: options.agentId,
      runId: options.runId,
      toolCallId: options.toolCallId,
      startedAt: new Date().toISOString(),
      status: "running",
      logs: "",
      maxRuntimeMs: maxRuntime,
    };
    this.tasks.set(task.id, task);
    void this.persist(task);
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: unknown) => {
      task.logs += String(chunk);
      if (Buffer.byteLength(task.logs) > this.maxLogBytes) {
        task.logs = task.logs.slice(-this.maxLogBytes);
        task.truncated = true;
      }
      void this.persist(task);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let timer: NodeJS.Timeout | undefined;
    if (maxRuntime) timer = setTimeout(() => child.kill("SIGTERM"), maxRuntime);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      task.completedAt = new Date().toISOString();
      task.exitCode = code ?? undefined;
      if (task.status !== "cancelled")
        task.status = code === 0 ? "completed" : "failed";
      this.children.delete(task.id);
      void this.persist(task);
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
    if (
      !["completed", "failed", "cancelled", "orphaned"].includes(task.status)
    ) {
      task.status = "cancelled";
      task.completedAt = new Date().toISOString();
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
      },
    );
  }
  list(): SupervisedTask[] {
    return Array.from(this.tasks.values());
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

function clampTimeout(
  timeoutMs: number | undefined,
  maxTaskRuntimeMs: number | undefined,
): number | undefined {
  if (timeoutMs && maxTaskRuntimeMs)
    return Math.min(timeoutMs, maxTaskRuntimeMs);
  return timeoutMs ?? maxTaskRuntimeMs;
}
