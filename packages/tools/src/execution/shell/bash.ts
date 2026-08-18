import {
  spawnManagedChildProcess,
  terminateManagedChildProcess,
} from "@nervekit/native";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { resolveCommandCwd } from "../common/command-cwd.js";
import { BoundedProcessOutput } from "../common/bounded-process-output.js";
import { LiveOutputDelivery } from "../common/live-output.js";
import { forceKillProcessTree } from "../common/process-tree.js";
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
  const output = new BoundedProcessOutput();
  const startedAt = performance.now();

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    if (context.signal?.aborted) {
      reject(new Error("Command aborted."));
      return;
    }

    const shellConfig = resolveBashShellConfig({
      shellPath: context.shellPath,
    });
    const child = spawnManagedChildProcess(
      shellConfig.shell,
      [...shellConfig.args, args.command as string],
      {
        cwd,
        env: nonInteractiveShellEnv(),
      },
    );

    const liveOutput = new LiveOutputDelivery(context.onUpdate);
    let settled = false;
    let timedOut = false;
    let timeoutKilled = false;
    let timeout: NodeJS.Timeout | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      context.signal?.removeEventListener("abort", onAbort);
    };
    const terminateGracefully = () => {
      void terminateManagedChildProcess(child, "SIGTERM").then((result) => {
        if (!result || result.error) {
          rejectTerminationFailure(
            result?.error ?? "Native managed process metadata is unavailable",
          );
        }
      }, rejectTerminationFailure);
    };
    const rejectTerminationFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Failed to terminate command process tree: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void forceKillProcessTree(child).then(
        () => reject(new Error("Command aborted.")),
        () =>
          reject(
            new Error("Command aborted after process termination failed."),
          ),
      );
    };

    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutSeconds !== undefined && timeoutSeconds > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        timeoutKilled = true;
        if (process.platform === "win32") {
          void forceKillProcessTree(child).catch(rejectTerminationFailure);
          return;
        }
        terminateGracefully();
        forceKillTimeout = setTimeout(() => {
          if (!settled) {
            void forceKillProcessTree(child).catch(rejectTerminationFailure);
          }
        }, FORCE_KILL_AFTER_MS);
      }, timeoutSeconds * 1000);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      output.push("stdout", chunk);
      liveOutput.write("stdout", chunk, child.stdout ?? undefined);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output.push("stderr", chunk);
      liveOutput.write("stderr", chunk, child.stderr ?? undefined);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      void liveOutput
        .end()
        .then(() =>
          buildResult(output.snapshot(), code, signal, context.dataDir, {
            durationMs: Math.round(performance.now() - startedAt),
            timedOut,
            timeoutKilled,
            timeoutMessage:
              timeoutSeconds !== undefined
                ? `Command timed out after ${timeoutSeconds}s and ${timeoutKilled ? "was killed" : "was not killed"}.`
                : undefined,
          }),
        )
        .then(resolve)
        .catch(reject);
    });
  });
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
