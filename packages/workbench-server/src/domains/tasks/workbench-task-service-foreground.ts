import { readFile } from "node:fs/promises";
import {
  buildProcessResult,
  buildProcessTextResult,
  type ToolExecutionResult,
} from "@nervekit/host-runtime/tools";
import { isActiveTaskStatus } from "./index.js";
import type {
  ForegroundBashPromotionInput,
  ForegroundBashPromotionResult,
  WorkbenchTaskService,
} from "./workbench-task-service.js";
import { foregroundPromotionDelayMs } from "./workbench-task-service-utils.js";

export async function buildForegroundBashResult(
  this: WorkbenchTaskService,
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
    details: { execution: { disposition: "completed" } },
  });
}

export async function runForegroundBashWithPromotion(
  this: WorkbenchTaskService,
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
  let promotionTimer: NodeJS.Timeout | undefined;
  let promotionPromise: Promise<"promote"> | undefined;
  if (input.autoPromoteAfterMs !== undefined) {
    const promotionDelayMs = foregroundPromotionDelayMs({
      timeoutMs: input.timeoutMs,
      autoPromoteAfterMs: input.autoPromoteAfterMs,
    });
    promotionPromise = new Promise<"promote">((resolvePromote) => {
      promotionTimer = setTimeout(
        () => resolvePromote("promote"),
        promotionDelayMs,
      );
    });
  }
  const completionPromise = managed.terminalPromise.then(
    () => "completed" as const,
  );
  const outcomePromises: Array<Promise<"completed" | "promote" | "aborted">> = [
    completionPromise,
    abortPromise,
  ];
  if (promotionPromise) outcomePromises.push(promotionPromise);

  let outcome: "completed" | "promote" | "aborted";
  try {
    outcome = await Promise.race(outcomePromises);
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
    `Command was backgrounded after ${Math.round(elapsedMs / 1000)}s as task ${promoted.id}.`,
    `Command: ${promoted.command}`,
    `Elapsed: ${Math.round(elapsedMs / 1000)}s`,
    "",
    "Recent output:",
    recentOutput || "(no captured log lines yet)",
    "",
    "A terminal status and output update will arrive automatically. Do not poll.",
    `Use task_status({ taskId: "${promoted.id}" }) or task_logs({ taskId: "${promoted.id}" }) only for on-demand diagnostics.`,
    `Use task_cancel({ taskId: "${promoted.id}" }) to stop it explicitly.`,
  ].join("\n");
  const result = await buildProcessTextResult({
    text,
    outputFilePrefix: "nerve-task-promotion",
    exitMessagePrefix: "Command promotion",
    dataDir: this.taskRepository.storageHome,
    details: {
      execution: {
        disposition: "backgrounded",
        taskId: promoted.id,
        status: promoted.status,
        elapsedMs,
        terminalUpdate: "automatic",
      },
    },
  });
  return { kind: "promoted", task: promoted, result, elapsedMs };
}
