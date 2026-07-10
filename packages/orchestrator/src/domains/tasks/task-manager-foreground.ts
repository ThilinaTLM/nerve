import { readFile } from "node:fs/promises";
import {
  buildProcessResult,
  buildProcessTextResult,
  type ToolExecutionResult,
} from "@nervekit/agent-tools";
import { isActiveTaskStatus } from "./index.js";
import type {
  ForegroundBashPromotionInput,
  ForegroundBashPromotionResult,
  TaskManager,
} from "./task-manager.js";
import { foregroundPromotionDelayMs } from "./task-manager-utils.js";

const _FOREGROUND_TIMEOUT_RESULT_GRACE_MS = 500;

export async function buildForegroundBashResult(
  this: TaskManager,
  taskId: string,
): Promise<ToolExecutionResult> {
  const task = this.getTask(taskId);
  const [stdout, stderr, combinedFromFile] = await Promise.all([
    readFile(task.stdoutPath).catch(() => Buffer.alloc(0)),
    readFile(task.stderrPath).catch(() => Buffer.alloc(0)),
    task.combinedPath
      ? readFile(task.combinedPath).catch(() => Buffer.alloc(0))
      : Promise.resolve(Buffer.alloc(0)),
  ]);
  const combined =
    combinedFromFile.length > 0
      ? combinedFromFile
      : Buffer.concat([stdout, stderr]);
  const timedOut = task.status === "timed_out";
  return buildProcessResult({
    stdoutChunks: stdout.length > 0 ? [stdout] : [],
    stderrChunks: stderr.length > 0 ? [stderr] : [],
    combinedChunks: combined.length > 0 ? [combined] : [],
    code: task.exitCode ?? null,
    signal: (task.signal as NodeJS.Signals | null | undefined) ?? null,
    outputFilePrefix: "nerve-bash",
    exitMessagePrefix: "Command",
    dataDir: this.taskRepository.storageHome,
    timedOut,
    timeoutKilled: timedOut,
    timeoutMessage: task.error,
    details: { foregroundTaskId: task.id },
  });
}

export async function runForegroundBashWithPromotion(
  this: TaskManager,
  input: ForegroundBashPromotionInput,
): Promise<ForegroundBashPromotionResult> {
  if (input.signal?.aborted) throw new Error("Command aborted.");

  const startedAt = Date.now();
  const task = await this.startTask({
    workerId: input.workerId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    agentId: input.agentId,
    cwd: input.cwd,
    command: input.command,
    timeoutMs: input.timeoutMs,
    notify: false,
    origin: input.origin,
    completion: { inject: false, outputTailLineCount: 80 },
    visibility: "foreground",
    onOutput: input.onOutput,
  });
  const managed = this.managed.get(task.id);
  if (!managed?.terminalPromise) {
    throw new Error("Foreground bash task did not start correctly.");
  }

  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<"aborted">((resolveAbort) => {
    abortHandler = () => resolveAbort("aborted");
    input.signal?.addEventListener("abort", abortHandler, { once: true });
  });
  const promotionDelayMs = foregroundPromotionDelayMs(input);
  let promotionTimer: NodeJS.Timeout | undefined;
  const promotionPromise = new Promise<"promote">((resolvePromote) => {
    promotionTimer = setTimeout(
      () => resolvePromote("promote"),
      promotionDelayMs,
    );
  });
  const completionPromise = managed.terminalPromise.then(
    () => "completed" as const,
  );

  let outcome: "completed" | "promote" | "aborted";
  try {
    outcome = await Promise.race([
      completionPromise,
      promotionPromise,
      abortPromise,
    ]);
  } finally {
    if (promotionTimer) clearTimeout(promotionTimer);
    if (abortHandler) input.signal?.removeEventListener("abort", abortHandler);
  }

  if (outcome === "aborted") {
    await this.cancelTask(task.id, {
      reason: "Foreground bash aborted.",
    }).catch(() => undefined);
    await this.removeTask(task.id).catch(() => undefined);
    throw new Error("Command aborted.");
  }

  if (outcome === "completed") {
    const result = await this.buildForegroundBashResult(task.id);
    await this.removeTask(task.id).catch(() => undefined);
    return { kind: "completed_foreground", result };
  }

  const latest = this.getTask(task.id);
  if (!isActiveTaskStatus(latest.status)) {
    const result = await this.buildForegroundBashResult(task.id);
    await this.removeTask(task.id).catch(() => undefined);
    return { kind: "completed_foreground", result };
  }

  const latestManaged = this.managed.get(task.id);
  if (latestManaged) latestManaged.onOutput = undefined;
  const promoted = await this.updateTask(task.id, {
    visibility: "background",
    completion: {
      inject: input.continueAfterPromotion !== false,
      outputTailLineCount: 80,
    },
    notifications: {
      enabled: true,
      ready: true,
      terminal: true,
      outputTailLineCount: 80,
    },
  });
  await this.events.publish("task.promoted", { task: promoted });
  const elapsedMs = Date.now() - startedAt;
  const logs = await this.queryLogs(promoted.id, {
    mode: "recent",
    limit: 20,
  });
  const recentOutput = logs.events
    .map(
      (event) => `[${event.seq} ${event.stream} ${event.level}] ${event.line}`,
    )
    .join("\n");
  const text = [
    `Command is still running after ${Math.round(elapsedMs / 1000)}s, so Nerve promoted it to background task ${promoted.id}.`,
    `Command: ${promoted.command}`,
    `Elapsed: ${Math.round(elapsedMs / 1000)}s`,
    "",
    "Recent output:",
    recentOutput || "(no captured log lines yet)",
    "",
    "Nerve will send an async task update when it finishes.",
    `Inspect: task_status({ taskId: "${promoted.id}", includeLogs: true }) or task_logs({ taskId: "${promoted.id}" }).`,
    `Cancel: task_cancel({ taskId: "${promoted.id}" }).`,
  ].join("\n");
  const result = await buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-task-promotion",
    exitMessagePrefix: "Command promotion",
    dataDir: this.taskRepository.storageHome,
    details: {
      promotedToTask: true,
      task: promoted,
      elapsedMs,
    },
  });
  return { kind: "promoted", task: promoted, result, elapsedMs };
}
