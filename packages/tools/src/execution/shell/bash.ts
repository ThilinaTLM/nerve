import { randomUUID } from "node:crypto";
import { ExecutionWorkerClient } from "@nervekit/native";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { resolveCommandCwd } from "../common/command-cwd.js";
import { BoundedProcessOutput } from "../common/bounded-process-output.js";
import { LiveOutputDelivery } from "../common/live-output.js";
import { buildProcessResult } from "../common/process-result.js";
import { resolveBashShellConfig } from "./shell-config.js";

const FORCE_KILL_AFTER_MS = 2000;

function nonInteractiveShellEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
  };
}

export async function executeBash(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new Error("Tool argument 'command' must be a non-empty string.");
  }

  const cwd = await resolveCommandCwd(context.cwd, args.cwd);
  const timeoutSeconds =
    typeof args.timeout === "number"
      ? Math.max(0, numberArg(args.timeout, 0))
      : undefined;
  if (!context.dataDir) {
    throw new Error(
      "Execution worker data directory is required. Pass a dataDir (NERVE_HOME) to run bash through the execution worker.",
    );
  }
  return executeBashInWorker(args.command, cwd, timeoutSeconds, context);
}

async function executeBashInWorker(
  command: string,
  cwd: string,
  timeoutSeconds: number | undefined,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (!context.dataDir)
    throw new Error("Execution worker data directory is required.");
  if (context.signal?.aborted) throw new Error("Command aborted.");
  const worker = await ExecutionWorkerClient.connect(context.dataDir);
  const executionId = context.executionId ?? `bash_${randomUUID()}`;
  const shell = resolveBashShellConfig({ shellPath: context.shellPath });
  const output = new BoundedProcessOutput();
  const liveOutput = new LiveOutputDelivery(context.onUpdate);
  const startedAt = performance.now();
  const onAbort = () => {
    void worker.cancel(executionId, "SIGKILL").catch(() => undefined);
  };
  context.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const existing = context.executionId
      ? await worker.get(executionId)
      : undefined;
    if (!existing)
      await worker.start({
        executionId,
        command: shell.shell,
        args: [...shell.args, command],
        cwd,
        env: Object.fromEntries(
          Object.entries(nonInteractiveShellEnv()).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        timeoutMs:
          timeoutSeconds !== undefined && timeoutSeconds > 0
            ? timeoutSeconds * 1_000
            : undefined,
        terminationGraceMs: FORCE_KILL_AFTER_MS,
        belowNormalPriority: true,
      });
    const terminal = await worker.subscribe(executionId, {
      signal: context.signal,
      onOutput: (stream, chunk) => {
        output.push(stream, chunk);
        liveOutput.write(stream, chunk);
      },
    }).settled;
    await liveOutput.end();
    const timedOut =
      timeoutSeconds !== undefined &&
      performance.now() - startedAt >= timeoutSeconds * 1_000 &&
      terminal.status === "failed";
    return await buildResult(
      output.snapshot(),
      terminal.exitCode ?? null,
      (terminal.signal as NodeJS.Signals | undefined) ?? null,
      context.dataDir,
      {
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
        timeoutKilled: timedOut,
        timeoutMessage: timedOut
          ? `Command timed out after ${timeoutSeconds}s and was killed.`
          : undefined,
      },
    );
  } catch (error) {
    if (context.signal?.aborted) {
      throw new Error("Command aborted.", { cause: error });
    }
    throw error;
  } finally {
    context.signal?.removeEventListener("abort", onAbort);
    if (!context.executionId) {
      void worker.remove(executionId).catch(() => undefined);
    }
  }
}

async function buildResult(
  output: ReturnType<BoundedProcessOutput["snapshot"]>,
  code: number | null,
  signal: NodeJS.Signals | null,
  dataDir: string | undefined,
  options: {
    durationMs?: number;
    timedOut?: boolean;
    timeoutKilled?: boolean;
    timeoutMessage?: string;
  } = {},
): Promise<ToolExecutionResult> {
  return buildProcessResult({
    stdoutChunks: output.stdoutChunks,
    stderrChunks: output.stderrChunks,
    combinedChunks: output.combinedChunks,
    code,
    signal,
    outputFilePrefix: "nerve-bash",
    exitMessagePrefix: "Command",
    dataDir,
    durationMs: options.durationMs,
    timedOut: options.timedOut,
    timeoutKilled: options.timeoutKilled,
    timeoutMessage: options.timeoutMessage,
    details: {
      outputRetention: {
        totalBytes: output.totalBytes,
        retainedBytes: output.retainedBytes,
        omittedBytes: output.omittedBytes,
        truncated: output.truncated,
      },
    },
    contentFooterLines: output.truncated
      ? [
          `${output.omittedBytes} output bytes were omitted by process retention.`,
        ]
      : [],
  });
}
