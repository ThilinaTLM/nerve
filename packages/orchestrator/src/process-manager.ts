import { type ChildProcess, spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createId,
  type ProcessLogEvent,
  type ProcessLogQuery,
  type ProcessLogQueryResponse,
  type ProcessRecord,
  processLogEventSchema,
  processRecordSchema,
  type StartProcessRequest,
  type StopProcessRequest,
} from "@nerve/shared";
import type { EventBus } from "./events.js";
import type { IndexStore } from "./index-store.js";
import {
  appendJsonLine,
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
  readJsonLines,
} from "./storage.js";

interface ManagedProcess {
  child?: ChildProcess;
  logSeq: number;
  stopping: boolean;
  readinessTimer?: NodeJS.Timeout;
  readinessPattern?: RegExp;
}

const urlPattern = /https?:\/\/[^\s)'"]+/i;

export class ProcessManager {
  readonly processes = new Map<string, ProcessRecord>();
  private readonly managed = new Map<string, ManagedProcess>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<void> {
    const root = join(this.storage.paths.home, "proc");
    for (const processId of await listChildDirs(root)) {
      const parsed = processRecordSchema.safeParse(
        await readJsonFile<unknown>(
          join(root, processId, "process.json"),
        ).catch(() => undefined),
      );
      if (!parsed.success) continue;
      const record = isActiveStatus(parsed.data.status)
        ? {
            ...parsed.data,
            status: "orphaned" as const,
            error: "Process supervision was lost after daemon restart.",
            updatedAt: new Date().toISOString(),
          }
        : parsed.data;
      this.processes.set(record.id, record);
      this.index.upsertProcess(record);
      if (record !== parsed.data) await this.writeProcess(record);
    }
  }

  listProcesses(): ProcessRecord[] {
    return [...this.processes.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  getProcess(processId: string): ProcessRecord {
    const process = this.processes.get(processId);
    if (!process) throw new Error("Process not found.");
    return process;
  }

  findProcessByName(name: string): ProcessRecord | undefined {
    return this.listProcesses().find((process) => process.name === name);
  }

  async startProcess(
    request: StartProcessRequest & {
      restartedFromProcessId?: string;
      workerId?: string;
    },
  ): Promise<ProcessRecord> {
    const now = new Date().toISOString();
    const id = createId("proc");
    const dir = this.processDir(id);
    await mkdir(dir, { recursive: true, mode: 0o755 });

    const readiness = {
      readyOnUrl: request.readyOnUrl,
      readyPattern: request.readyPattern,
      timeoutMs: request.readyTimeoutMs ?? 3000,
      outcome:
        request.readyOnUrl || request.readyPattern
          ? ("pending" as const)
          : ("none" as const),
    };
    const record: ProcessRecord = {
      id,
      name: request.name,
      workerId: request.workerId,
      projectId: request.projectId,
      sessionId: request.sessionId,
      agentId: request.agentId,
      cwd: resolve(request.cwd),
      command: request.command,
      status: "starting",
      readiness,
      stdoutPath: join(dir, "stdout.log"),
      stderrPath: join(dir, "stderr.log"),
      logsPath: join(dir, "logs.jsonl"),
      startedAt: now,
      updatedAt: now,
      restartedFromProcessId: request.restartedFromProcessId,
    };

    const readinessPattern = request.readyPattern
      ? new RegExp(request.readyPattern, "i")
      : undefined;

    await this.upsertProcess(record);
    await this.events.publish("process.created", { process: record });

    const child = spawn(request.command, {
      cwd: record.cwd,
      shell: true,
      env: { ...process.env, ...(request.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const managed: ManagedProcess = {
      child,
      logSeq: await this.latestLogSeq(record.logsPath),
      stopping: false,
      readinessPattern,
    };
    this.managed.set(record.id, managed);

    child.stdout?.on("data", (chunk) => {
      void this.captureOutput(record.id, "stdout", chunk);
    });
    child.stderr?.on("data", (chunk) => {
      void this.captureOutput(record.id, "stderr", chunk);
    });
    child.on("error", (error) => {
      void this.markProcessError(record.id, error.message);
    });
    child.on("close", (exitCode, signal) => {
      void this.markProcessExited(record.id, exitCode, signal);
    });

    await this.updateProcess(record.id, { status: "running" });
    await this.events.publish("process.started", {
      process: this.getProcess(record.id),
      pid: child.pid,
    });

    await this.waitForReadiness(record.id);
    return this.getProcess(record.id);
  }

  async stopProcess(
    processId: string,
    request: StopProcessRequest = {},
  ): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    const managed = this.managed.get(record.id);
    if (!managed?.child || !isActiveStatus(record.status)) return record;

    managed.stopping = true;
    await this.updateProcess(record.id, { status: "stopping" });
    await this.events.publish("process.stop_requested", {
      processId: record.id,
      signal: request.signal ?? "SIGTERM",
    });

    const stopped = new Promise<void>((resolveStop) => {
      managed.child?.once("close", () => resolveStop());
    });
    terminateProcess(managed.child, request.signal ?? "SIGTERM");
    const timeout = setTimeout(() => {
      if (managed.child) terminateProcess(managed.child, "SIGKILL");
    }, request.timeoutMs ?? 5000);
    await stopped.finally(() => clearTimeout(timeout));
    return this.getProcess(processId);
  }

  async restartProcess(processId: string): Promise<ProcessRecord> {
    const record = this.getProcess(processId);
    if (isActiveStatus(record.status)) await this.stopProcess(processId);
    return this.startProcess({
      name: record.name,
      workerId: record.workerId,
      projectId: record.projectId,
      sessionId: record.sessionId,
      agentId: record.agentId,
      cwd: record.cwd,
      command: record.command,
      readyOnUrl: record.readiness.readyOnUrl,
      readyPattern: record.readiness.readyPattern,
      readyTimeoutMs: record.readiness.timeoutMs,
      restartedFromProcessId: record.id,
    });
  }

  async queryLogs(
    processId: string,
    query: ProcessLogQuery = {},
  ): Promise<ProcessLogQueryResponse> {
    const process = this.getProcess(processId);
    const mode = query.mode ?? "recent";
    const limit = query.limit ?? 100;
    const contextLines = query.contextLines ?? 2;
    const allEvents = await this.readLogEvents(process.logsPath);
    let events = allEvents;

    if (mode === "since_cursor") {
      events = events.filter((event) => event.seq > (query.sinceSeq ?? 0));
    } else if (mode === "errors") {
      events = events.filter((event) => event.level === "error");
    } else if (mode === "warnings") {
      events = events.filter((event) => event.level === "warn");
    } else if (mode === "first_failure") {
      const index = allEvents.findIndex((event) => event.level === "error");
      events =
        index >= 0
          ? allEvents.slice(
              Math.max(0, index - contextLines),
              index + contextLines + 1,
            )
          : [];
    }

    if (query.contains) {
      const contains = query.contains.toLowerCase();
      events = events.filter((event) =>
        event.line.toLowerCase().includes(contains),
      );
    }
    if (query.regex) {
      const matcher = new RegExp(query.regex, "i");
      events = events.filter((event) => matcher.test(event.line));
    }
    if (mode !== "first_failure") events = events.slice(-limit);

    return {
      process,
      events,
      nextCursor: allEvents.at(-1)?.seq ?? 0,
      mode,
    };
  }

  private async captureOutput(
    processId: string,
    stream: "stdout" | "stderr",
    chunk: Buffer | string,
  ): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record || !managed) return;
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    const path = stream === "stdout" ? record.stdoutPath : record.stderrPath;
    await appendFile(path, text, "utf8");
    for (const line of splitLines(text)) {
      managed.logSeq += 1;
      const event: ProcessLogEvent = {
        seq: managed.logSeq,
        ts: new Date().toISOString(),
        stream,
        level: classifyLogLevel(stream, line),
        line,
      };
      await appendJsonLine(record.logsPath, event, 0o600);
      await this.events.publish("process.log", {
        processId: record.id,
        projectId: record.projectId,
        sessionId: record.sessionId,
        agentId: record.agentId,
        log: event,
      });
      await this.checkReadiness(record.id, event);
    }
  }

  private async checkReadiness(
    processId: string,
    log: ProcessLogEvent,
  ): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record || !managed || record.readiness.outcome !== "pending") return;
    const url = record.readiness.readyOnUrl
      ? log.line.match(urlPattern)?.[0]
      : undefined;
    const pattern = managed.readinessPattern?.exec(log.line)?.[0];
    const matched = url ?? pattern;
    if (!matched) return;
    if (managed.readinessTimer) clearTimeout(managed.readinessTimer);
    const ready = await this.updateProcess(processId, {
      status: "ready",
      readiness: {
        ...record.readiness,
        outcome: "ready",
        matched,
        readyAt: new Date().toISOString(),
      },
    });
    await this.events.publish("process.ready", { process: ready, matched });
  }

  private async waitForReadiness(processId: string): Promise<void> {
    const record = this.getProcess(processId);
    if (record.readiness.outcome !== "pending") return;
    const managed = this.managed.get(processId);
    const timeoutMs = record.readiness.timeoutMs ?? 3000;
    if (!managed || timeoutMs <= 0) return;
    await new Promise<void>((resolveWait) => {
      let unsubscribe: () => void = () => undefined;
      const resolveOnce = () => {
        unsubscribe();
        resolveWait();
      };
      managed.readinessTimer = setTimeout(() => {
        void this.markReadinessTimeout(processId).finally(resolveOnce);
      }, timeoutMs);
      unsubscribe = this.events.subscribe((event) => {
        if (event.type !== "process.ready" && event.type !== "process.exited")
          return;
        const data = event.data as { process?: { id?: string } };
        if (data.process?.id !== processId) return;
        resolveOnce();
      });
    });
  }

  private async markReadinessTimeout(processId: string): Promise<void> {
    const record = this.processes.get(processId);
    if (!record || record.readiness.outcome !== "pending") return;
    const updated = await this.updateProcess(processId, {
      readiness: { ...record.readiness, outcome: "timeout" },
    });
    await this.events.publish("process.ready_timeout", { process: updated });
  }

  private async markProcessExited(
    processId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const record = this.processes.get(processId);
    const managed = this.managed.get(processId);
    if (!record) return;
    if (managed?.readinessTimer) clearTimeout(managed.readinessTimer);
    const status = managed?.stopping
      ? "stopped"
      : exitCode === 0
        ? "exited"
        : "error";
    const readiness =
      record.readiness.outcome === "pending"
        ? { ...record.readiness, outcome: "exited" as const }
        : record.readiness;
    const updated = await this.updateProcess(processId, {
      status,
      readiness,
      exitedAt: new Date().toISOString(),
      exitCode,
      signal,
    });
    this.managed.delete(processId);
    await this.events.publish("process.exited", { process: updated });
  }

  private async markProcessError(
    processId: string,
    message: string,
  ): Promise<void> {
    const record = this.processes.get(processId);
    if (!record) return;
    const updated = await this.updateProcess(processId, {
      status: "error",
      error: message,
    });
    await this.events.publish("process.error", { process: updated, message });
  }

  private async updateProcess(
    processId: string,
    patch: Partial<Omit<ProcessRecord, "id" | "startedAt">>,
  ): Promise<ProcessRecord> {
    const current = this.getProcess(processId);
    const updated: ProcessRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertProcess(updated);
    return updated;
  }

  private async upsertProcess(record: ProcessRecord): Promise<void> {
    this.processes.set(record.id, record);
    this.index.upsertProcess(record);
    await this.writeProcess(record);
  }

  private async writeProcess(record: ProcessRecord): Promise<void> {
    await atomicWriteJson(
      join(this.processDir(record.id), "process.json"),
      record,
      0o600,
    );
  }

  private async latestLogSeq(logsPath: string): Promise<number> {
    const events = await this.readLogEvents(logsPath);
    return events.at(-1)?.seq ?? 0;
  }

  private async readLogEvents(logsPath: string): Promise<ProcessLogEvent[]> {
    const values = await readJsonLines<unknown>(logsPath).catch(() => []);
    return values
      .map((value) => processLogEventSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => result.data)
      .sort((a, b) => a.seq - b.seq);
  }

  private processDir(processId: string): string {
    return join(this.storage.paths.home, "proc", processId);
  }
}

function terminateProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child below.
    }
  }
  child.kill(signal);
}

function isActiveStatus(status: ProcessRecord["status"]): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "ready" ||
    status === "stopping"
  );
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function classifyLogLevel(
  stream: "stdout" | "stderr",
  line: string,
): ProcessLogEvent["level"] {
  if (/\b(warn|warning)\b/i.test(line)) return "warn";
  if (
    stream === "stderr" ||
    /\b(error|failed|failure|exception|fatal)\b/i.test(line)
  )
    return "error";
  return "info";
}
