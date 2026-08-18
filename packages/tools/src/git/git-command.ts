import { spawnManagedProcess } from "@nervekit/native";

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 16 * 1024 * 1024;

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
): Promise<ExecResult> {
  const command = `${bin} ${args.join(" ")}`;
  let child;
  try {
    child = spawnManagedProcess(bin, args, {
      cwd,
      env: process.env,
    });
  } catch (error) {
    throw new GitCommandError(command, null, errorMessage(error));
  }

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let failure: "timeout" | "overflow" | "stream" | undefined;
  let streamError = "";

  const terminate = (reason: typeof failure, error?: unknown): void => {
    if (failure) return;
    failure = reason;
    streamError = error ? errorMessage(error) : "";
    void child.terminate("SIGKILL").catch(() => {
      // The close result below remains the authoritative lifecycle signal.
    });
  };
  child.stdout.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stdoutBytes += buffer.length;
    if (stdoutBytes > MAX_BUFFER) terminate("overflow");
    else stdout.push(buffer);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderrBytes += buffer.length;
    if (stderrBytes > MAX_BUFFER) terminate("overflow");
    else stderr.push(buffer);
  });
  child.stdout.once("error", (error) => terminate("stream", error));
  child.stderr.once("error", (error) => terminate("stream", error));

  const timer = setTimeout(() => terminate("timeout"), COMMAND_TIMEOUT_MS);
  let result: Awaited<typeof child.closed>;
  try {
    result = await child.closed;
  } catch (error) {
    throw new GitCommandError(command, null, errorMessage(error));
  } finally {
    clearTimeout(timer);
  }

  const stdoutText = Buffer.concat(stdout).toString("utf8");
  const stderrText = Buffer.concat(stderr).toString("utf8");
  if (failure === "timeout") {
    throw new GitCommandError(
      command,
      null,
      `Git command timed out after ${COMMAND_TIMEOUT_MS}ms.`,
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
