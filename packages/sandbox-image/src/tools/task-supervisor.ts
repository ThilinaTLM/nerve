import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";

export type SupervisedTask = {
  id: string;
  command: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  exitCode?: number;
  logs: string;
  truncated?: boolean;
};

export class TaskSupervisor {
  private readonly tasks = new Map<string, SupervisedTask>();
  private readonly children = new Map<
    string,
    ChildProcessByStdio<null, Readable, Readable>
  >();
  constructor(private readonly maxLogBytes = 64_000) {}
  start(
    command: string,
    cwd = "/workspace",
    timeoutMs?: number,
  ): SupervisedTask {
    const task: SupervisedTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      command,
      startedAt: new Date().toISOString(),
      status: "running",
      logs: "",
    };
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
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs) timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      task.completedAt = new Date().toISOString();
      task.exitCode = code ?? undefined;
      if (task.status === "cancelled") return;
      task.status = code === 0 ? "completed" : "failed";
      this.children.delete(task.id);
    });
    this.tasks.set(task.id, task);
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
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    child?.kill(signal);
    this.children.delete(id);
    return task;
  }
  list(): SupervisedTask[] {
    return Array.from(this.tasks.values());
  }
  get(id: string): SupervisedTask | undefined {
    return this.tasks.get(id);
  }
}
