import {
  type spawnManagedChildProcess,
  terminateManagedChildProcess,
} from "@nervekit/native";
import type { ToolExecutionResult } from "../execution-context.js";
import { BoundedProcessOutput } from "../output/bounded-process-output.js";
import { LiveOutputDelivery } from "../output/live-output.js";
import { forceKillProcessTree } from "./process-tree.js";

const FORCE_KILL_AFTER_MS = 2000;

type ManagedChild = ReturnType<typeof spawnManagedChildProcess>;

export type ManagedProcessClose = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  timeoutKilled: boolean;
  /** `<timeoutLabel> timed out after <n>s and was killed.`; set only when a timeout is configured. */
  timeoutMessage: string | undefined;
  durationMs: number;
  output: BoundedProcessOutput;
  liveOutput: LiveOutputDelivery;
};

export type RunManagedProcessOptions = {
  /** Spawns the child; a throw is passed through `mapSpawnError`. */
  spawn: () => ManagedChild;
  signal?: AbortSignal;
  onUpdate?: ConstructorParameters<typeof LiveOutputDelivery>[0];
  /** Seconds; unset or 0 means no timeout. */
  timeoutSeconds?: number;
  /** Subject of the timeout message, e.g. `Command`. */
  timeoutLabel: string;
  /** Rejection for an abort, e.g. `Command aborted.`; the abort-failed variant is derived from it. */
  abortedMessage: string;
  /** Noun in `Failed to terminate <noun> process tree`. */
  terminationNoun: string;
  /** Maps a spawn failure or child `error` event to the rejection. */
  mapSpawnError?: (error: unknown) => unknown;
  /** Runs when the process closes, before live output ends (may push final output). */
  beforeEnd?: (close: ManagedProcessClose) => void;
  /** Builds the result once live output has ended. */
  buildResult: (close: ManagedProcessClose) => Promise<ToolExecutionResult>;
};

/**
 * Shared lifecycle of the bash and python tools: spawn, stream bounded and live
 * output, graceful-then-forced timeout kill, abort kill, and result building.
 * What differs per tool (policy, spawn arguments, result shape) stays with the caller.
 */
export async function runManagedProcess(
  options: RunManagedProcessOptions,
): Promise<ToolExecutionResult> {
  const { signal, timeoutSeconds } = options;
  const mapSpawnError = options.mapSpawnError ?? ((error: unknown) => error);
  const output = new BoundedProcessOutput();
  const startedAt = performance.now();

  return await new Promise<ToolExecutionResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(options.abortedMessage));
      return;
    }

    let child: ManagedChild;
    try {
      child = options.spawn();
    } catch (error) {
      reject(mapSpawnError(error));
      return;
    }

    const liveOutput = new LiveOutputDelivery(options.onUpdate);
    const hasTimeout = timeoutSeconds !== undefined && timeoutSeconds > 0;
    let settled = false;
    let timedOut = false;
    let timeoutKilled = false;
    let timeout: NodeJS.Timeout | undefined;
    let forceKillTimeout: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const rejectTerminationFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `Failed to terminate ${options.terminationNoun} process tree: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
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
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      void forceKillProcessTree(child).then(
        () => reject(new Error(options.abortedMessage)),
        () =>
          reject(
            new Error(
              `${options.abortedMessage.replace(/\.$/, "")} after process termination failed.`,
            ),
          ),
      );
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (hasTimeout) {
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
      reject(mapSpawnError(error));
    });
    child.on("close", (code, closeSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const close: ManagedProcessClose = {
        code,
        signal: closeSignal,
        timedOut,
        timeoutKilled,
        timeoutMessage: hasTimeout
          ? `${options.timeoutLabel} timed out after ${timeoutSeconds}s and ${timeoutKilled ? "was killed" : "was not killed"}.`
          : undefined,
        durationMs: Math.round(performance.now() - startedAt),
        output,
        liveOutput,
      };
      options.beforeEnd?.(close);
      void liveOutput
        .end()
        .then(() => options.buildResult(close))
        .then(resolve)
        .catch(reject);
    });
  });
}
