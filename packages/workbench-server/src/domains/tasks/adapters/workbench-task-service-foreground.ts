import { readFile } from "node:fs/promises";
import {
  buildProcessResult,
  buildProcessTextResult,
  type ToolExecutionResult,
} from "@nervekit/tools/execution";
import { isActiveTaskStatus } from "../index.js";
import type {
  ForegroundBashPromotionInput,
  ForegroundBashPromotionResult,
  WorkbenchTaskService,
} from "./workbench-task-service.js";
import { foregroundPromotionDelayMs } from "./workbench-task-service-support.js";

export async function buildForegroundBashResult(
  this: WorkbenchTaskService,
  taskId: string,
  artifactDir?: string,
): Promise<ToolExecutionResult> {
  const task = this.getTask(taskId);
  const retention = task.outputRetention;
  const stdout = await readFile(task.stdoutPath).catch(() => Buffer.alloc(0));
  const stderr = await readFile(task.stderrPath).catch(() => Buffer.alloc(0));
  const combined = task.combinedPath
    ? await readFile(task.combinedPath).catch(() => Buffer.alloc(0))
    : Buffer.alloc(0);
  const timedOut = task.status === "timed_out";
  return buildProcessResult({
    stdoutChunks: stdout.length > 0 ? [stdout] : [],
    stderrChunks: stderr.length > 0 ? [stderr] : [],
    combinedChunks:
      combined.length > 0
        ? [combined]
        : [
            ...(stdout.length > 0 ? [stdout] : []),
            ...(stderr.length > 0 ? [stderr] : []),
          ],
    code: task.exitCode ?? null,
    signal: (task.signal as NodeJS.Signals | null | undefined) ?? null,
    outputFilePrefix: "nerve-bash",
    exitMessagePrefix: "Command",
    dataDir: this.taskRepository.storageHome,
    artifactDir,
    timedOut,
    timeoutKilled: timedOut,
    timeoutMessage: task.error,
    details: {
      execution: { disposition: "completed" },
      ...(retention ? { outputRetention: retention } : {}),
    },
  });
}

function commandDisplayName(command: string): string {
  const firstLine = command.trim().split(/\r?\n/, 1)[0] ?? "Background command";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}

export async function runForegroundBashWithPromotion(
  this: WorkbenchTaskService,
  input: ForegroundBashPromotionInput,
): Promise<ForegroundBashPromotionResult> {
  if (input.signal?.aborted) throw new Error("Command aborted.");

  const startedAt = Date.now();
  const task = await this.startTask({
    projectId: input.projectId,
    conversationId: input.conversationId,
    agentId: input.agentId,
    cwd: input.cwd,
    command: input.command,
    displayName: commandDisplayName(input.command),
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
    if (input.signal?.aborted) abortHandler();
    else input.signal?.addEventListener("abort", abortHandler, { once: true });
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
    const terminalPromise = this.managed.get(task.id)?.terminalPromise;
    const cancelled = await this.cancelTask(task.id, {
      signal: "SIGKILL",
      reason: "Foreground bash aborted.",
    }).catch(() => this.getTask(task.id));
    if (isActiveTaskStatus(cancelled.status)) {
      await this.backgroundActiveTask(task.id, {
        visibility: "background",
        completion: { inject: false, outputTailLineCount: 80 },
        notifications: {
          enabled: true,
          ready: false,
          terminal: true,
          outputTailLineCount: 80,
        },
      }).catch(() => undefined);
    } else {
      await terminalPromise?.catch(() => undefined);
      await this.removeTask(task.id).catch(() => undefined);
    }
    throw new Error("Command aborted.");
  }

  if (outcome === "completed") {
    const result = await this.buildForegroundBashResult(
      task.id,
      input.artifactDir,
    );
    await this.removeTask(task.id).catch(() => undefined);
    return { kind: "completed_foreground", result };
  }

  const latest = this.getTask(task.id);
  if (!isActiveTaskStatus(latest.status)) {
    const result = await this.buildForegroundBashResult(
      task.id,
      input.artifactDir,
    );
    await this.removeTask(task.id).catch(() => undefined);
    return { kind: "completed_foreground", result };
  }

  const latestManaged = this.managed.get(task.id);
  if (latestManaged) latestManaged.onOutput = undefined;
  const promoted = await this.backgroundActiveTask(task.id, {
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
  if (!isActiveTaskStatus(promoted.status)) {
    const result = await this.buildForegroundBashResult(
      promoted.id,
      input.artifactDir,
    );
    await this.removeTask(promoted.id).catch(() => undefined);
    return { kind: "completed_foreground", result };
  }
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
    `Use task_status({ tasks: ["${promoted.id}"] }) or task_logs({ task: "${promoted.id}" }) only for on-demand diagnostics.`,
    `Use task_control({ task: "${promoted.id}", action: "stop" }) to stop it explicitly.`,
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
