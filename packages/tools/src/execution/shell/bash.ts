import { spawn } from "node:child_process";
import type { ToolExecutionContext, ToolExecutionResult } from "../../types.js";
import { numberArg } from "../common/args.js";
import { resolveCommandCwd } from "../common/command-cwd.js";
import { boundLiveOutputChunk } from "../common/output-budget.js";
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
    CI: process.env.CI ?? "1",
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
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const combinedChunks: Buffer[] = [];
  const startedAt = performance.now();

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    if (context.signal?.aborted) {
      reject(new Error("Command aborted."));
      return;
    }

    const shellConfig = resolveBashShellConfig({
      shellPath: context.shellPath,
    });
    const child = spawn(
      shellConfig.shell,
      [...shellConfig.args, args.command as string],
      {
        cwd,
        detached: process.platform !== "win32",
        env: nonInteractiveShellEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

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
    const killPosix = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
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
        killPosix("SIGTERM");
        forceKillTimeout = setTimeout(() => {
          if (!settled) {
            void forceKillProcessTree(child).catch(rejectTerminationFailure);
          }
        }, FORCE_KILL_AFTER_MS);
      }, timeoutSeconds * 1000);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      combinedChunks.push(chunk);
      context.onUpdate?.({
        kind: "output",
        stream: "stdout",
        chunk: boundLiveOutputChunk(chunk.toString("utf8")),
      });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      combinedChunks.push(chunk);
      context.onUpdate?.({
        kind: "output",
        stream: "stderr",
        chunk: boundLiveOutputChunk(chunk.toString("utf8")),
      });
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
      void buildResult(
        stdoutChunks,
        stderrChunks,
        combinedChunks,
        code,
        signal,
        context.dataDir,
        {
          durationMs: Math.round(performance.now() - startedAt),
          timedOut,
          timeoutKilled,
          timeoutMessage:
            timeoutSeconds !== undefined
              ? `Command timed out after ${timeoutSeconds}s and ${timeoutKilled ? "was killed" : "was not killed"}.`
              : undefined,
        },
      )
        .then(resolve)
        .catch(reject);
    });
  });
}

async function buildResult(
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  combinedChunks: Buffer[],
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
    stdoutChunks,
    stderrChunks,
    combinedChunks,
    code,
    signal,
    outputFilePrefix: "nerve-bash",
    exitMessagePrefix: "Command",
    dataDir,
    durationMs: options.durationMs,
    timedOut: options.timedOut,
    timeoutKilled: options.timeoutKilled,
    timeoutMessage: options.timeoutMessage,
  });
}
