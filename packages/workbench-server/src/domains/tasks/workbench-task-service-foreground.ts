import { open } from "node:fs/promises";
import {
  buildProcessResult,
  buildProcessTextResult,
  type ToolExecutionResult,
} from "@nervekit/tools";
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
  const retention = task.outputRetention;
  const tailChunks = retention?.tailPath
    ? await this.taskLogs.readTail(task)
    : [];
  const [stdoutHead, stderrHead, combinedHead] = await Promise.all([
    readBoundedFile(task.stdoutPath),
    readBoundedFile(task.stderrPath),
    task.combinedPath
      ? readBoundedFile(task.combinedPath)
      : Promise.resolve(Buffer.alloc(0)),
  ]);
  const omission = retention?.truncated
    ? Buffer.from(
        `\n[${retention.omittedBytes} output bytes omitted by task retention]\n`,
      )
    : tailChunks.length > 0
      ? Buffer.from(
          "\n[output middle omitted from inline result; retained in task logs]\n",
        )
      : Buffer.alloc(0);
  const stdout = combineSnapshot(
    stdoutHead,
    omission,
    tailChunks
      .filter((chunk) => chunk.stream === "stdout")
      .map((chunk) => chunk.text)
      .join(""),
  );
  const stderr = combineSnapshot(
    stderrHead,
    omission,
    tailChunks
      .filter((chunk) => chunk.stream === "stderr")
      .map((chunk) => chunk.text)
      .join(""),
  );
  const combined = combineSnapshot(
    combinedHead.length > 0
      ? combinedHead
      : Buffer.concat([stdoutHead, stderrHead]),
    omission,
    tailChunks.map((chunk) => chunk.text).join(""),
  );
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
    details: {
      execution: { disposition: "completed" },
      ...(retention ? { outputRetention: retention } : {}),
    },
    contentFooterLines:
      retention && retention.totalBytes > combined.length
        ? ["Output preview is bounded; use task_logs for retained diagnostics."]
        : [],
  });
}

const RESULT_HEAD_MAX_BYTES = 16 * 1024;
const RESULT_TAIL_MAX_BYTES = 16 * 1024;
const RESULT_FILE_MAX_BYTES = RESULT_HEAD_MAX_BYTES + RESULT_TAIL_MAX_BYTES;

async function readBoundedFile(path: string): Promise<Buffer> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return Buffer.alloc(0);
  try {
    const stat = await handle.stat();
    if (stat.size <= RESULT_FILE_MAX_BYTES) {
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
      return buffer.subarray(0, bytesRead);
    }
    const head = Buffer.alloc(RESULT_HEAD_MAX_BYTES);
    const tail = Buffer.alloc(RESULT_TAIL_MAX_BYTES);
    const [headRead, tailRead] = await Promise.all([
      handle.read(head, 0, head.length, 0),
      handle.read(tail, 0, tail.length, Math.max(0, stat.size - tail.length)),
    ]);
    return Buffer.concat([
      head.subarray(0, headRead.bytesRead),
      Buffer.from(
        `\n[${stat.size - headRead.bytesRead - tailRead.bytesRead} bytes omitted from inline result; retained in task logs]\n`,
      ),
      tail.subarray(0, tailRead.bytesRead),
    ]);
  } finally {
    await handle.close();
  }
}

function combineSnapshot(head: Buffer, omission: Buffer, tail: string): Buffer {
  if (omission.length === 0) return head;
  const tailBuffer = Buffer.from(tail);
  const boundedTail =
    tailBuffer.length > RESULT_TAIL_MAX_BYTES
      ? tailBuffer.subarray(tailBuffer.length - RESULT_TAIL_MAX_BYTES)
      : tailBuffer;
  return Buffer.concat([head, omission, boundedTail]);
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
    const result = await this.buildForegroundBashResult(promoted.id);
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
    `Use task_status({ taskId: "${promoted.id}" }) or task_logs({ taskId: "${promoted.id}" }) only for on-demand diagnostics.`,
    `Use task_control({ taskId: "${promoted.id}", action: "stop" }) to stop it explicitly.`,
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
