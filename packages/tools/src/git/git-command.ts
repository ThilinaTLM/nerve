import { spawnManagedProcess } from "@nervekit/native";
import { gitProcessPolicy } from "../execution/process/managed-process-policy.js";
import { gitProgressParser, type GitProgress } from "./git-progress.js";

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 16 * 1024 * 1024;
import {
  GIT_NETWORK_INACTIVITY_MS,
  GIT_NETWORK_DEADLINE_MS,
  GIT_TERMINATION_GRACE_MS,
} from "./git-operation-policy.js";
export {
  GIT_NETWORK_INACTIVITY_MS,
  GIT_NETWORK_DEADLINE_MS,
  GIT_TERMINATION_GRACE_MS,
} from "./git-operation-policy.js";

export interface GitCommandOptions {
  /** Internal producer correlation; never passed to Git or persisted. */
  activityId?: string;
  /** Monotonic workflow ceiling, shared by all commands in a multi-step operation. */
  deadlineAt?: number;
  signal?: AbortSignal;
  network?: boolean;
  onProgress?: (progress: GitProgress) => void;
  timeoutMs?: number;
  inactivityMs?: number;
  terminationGraceMs?: number;
}

export class GitCommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout = "",
  ) {
    super(stderr.trim() || `${command} failed`);
    this.name = "GitCommandError";
  }
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function runGitCommand(
  bin: "git" | "gh",
  cwd: string,
  args: string[],
  options: GitCommandOptions = {},
): Promise<ExecResult> {
  options.signal?.throwIfAborted();
  const timeoutMs = Math.min(
    options.timeoutMs ??
      (options.network ? GIT_NETWORK_DEADLINE_MS : COMMAND_TIMEOUT_MS),
    options.deadlineAt === undefined
      ? Infinity
      : Math.max(1, Math.ceil(options.deadlineAt - performance.now())),
  );
  const command = `${bin} ${args.join(" ")}`;
  if (
    options.deadlineAt !== undefined &&
    options.deadlineAt <= performance.now()
  )
    throw new GitCommandError(
      command,
      null,
      "Git command timed out at the operation deadline.",
    );
  let child;
  try {
    child = spawnManagedProcess(bin, args, {
      cwd,
      env: process.env,
      policy: {
        ...gitProcessPolicy(),
        wallTimeMs: timeoutMs + GIT_TERMINATION_GRACE_MS + 3_000,
      },
    });
  } catch (error) {
    throw new GitCommandError(command, null, errorMessage(error));
  }

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let failure: "timeout" | "overflow" | "stream" | "cancelled" | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let inactivity: ReturnType<typeof setTimeout> | undefined;
  let streamError = "";

  const terminate = (reason: typeof failure, error?: unknown): void => {
    if (failure) return;
    failure = reason;
    streamError = error ? errorMessage(error) : "";
    void child.terminate("SIGTERM").catch(() => {});
    escalation = setTimeout(() => {
      void child.terminate("SIGKILL").catch(() => {});
    }, options.terminationGraceMs ?? GIT_TERMINATION_GRACE_MS);
  };
  const resetInactivity = (): void => {
    if (!options.network || failure) return;
    clearTimeout(inactivity);
    inactivity = setTimeout(
      () => terminate("timeout"),
      options.inactivityMs ?? GIT_NETWORK_INACTIVITY_MS,
    );
  };
  const progress = gitProgressParser((value) => {
    try {
      options.onProgress?.(value);
    } catch {
      /* Reporting cannot disrupt process draining. */
    }
  });
  const abort = (): void => terminate("cancelled");
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  resetInactivity();
  child.stdout.on("data", (chunk: Buffer | string) => {
    resetInactivity();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stdoutBytes += buffer.length;
    if (stdoutBytes > MAX_BUFFER) terminate("overflow");
    else stdout.push(buffer);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    resetInactivity();
    progress(chunk);
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderrBytes += buffer.length;
    if (stderrBytes > MAX_BUFFER) terminate("overflow");
    else stderr.push(buffer);
  });
  child.stdout.once("error", (error) => terminate("stream", error));
  child.stderr.once("error", (error) => terminate("stream", error));

  const timer = setTimeout(() => terminate("timeout"), timeoutMs);
  let result: Awaited<typeof child.closed>;
  try {
    result = await child.closed;
  } catch (error) {
    throw new GitCommandError(command, null, errorMessage(error));
  } finally {
    clearTimeout(timer);
    clearTimeout(inactivity);
    clearTimeout(escalation);
    options.signal?.removeEventListener("abort", abort);
  }

  if (!failure && result.reason === "timeout") failure = "timeout";
  if (!failure && result.reason === "output_limit") failure = "overflow";

  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  if (failure === "cancelled")
    throw new DOMException("Git operation cancelled", "AbortError");
  if (failure === "timeout") {
    throw new GitCommandError(
      command,
      null,
      `Git command timed out (deadline ${timeoutMs}ms; network inactivity ${options.inactivityMs ?? GIT_NETWORK_INACTIVITY_MS}ms).`,
      stdoutText,
    );
  }
  if (failure === "overflow") {
    throw new GitCommandError(
      command,
      null,
      `Git command output exceeded ${MAX_BUFFER} bytes.`,
      stdoutText,
    );
  }
  if (failure === "stream") {
    throw new GitCommandError(
      command,
      null,
      streamError || "Could not read Git command output.",
      stdoutText,
    );
  }
  if (result.exitCode !== 0) {
    const detail =
      stderrText ||
      (result.signal
        ? `${command} terminated by ${result.signal}`
        : `${command} exited with code ${String(result.exitCode)}`);
    throw new GitCommandError(command, result.exitCode, detail, stdoutText);
  }
  return { stdout: stdoutText, stderr: stderrText };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
