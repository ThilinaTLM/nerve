import { randomUUID } from "node:crypto";
import { ExecutionWorkerClient } from "@nervekit/native";

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
  executionHome?: string,
): Promise<ExecResult> {
  if (!executionHome) {
    throw new GitCommandError(
      `${bin} ${args.join(" ")}`,
      null,
      "Execution worker home is required to run a git command. Pass an executionHome (NERVE_HOME).",
    );
  }
  return runGitCommandInWorker(bin, cwd, args, executionHome);
}

async function runGitCommandInWorker(
  bin: "git" | "gh",
  cwd: string,
  args: string[],
  executionHome: string,
): Promise<ExecResult> {
  const command = `${bin} ${args.join(" ")}`;
  const worker = await ExecutionWorkerClient.connect(executionHome);
  const executionId = `git_${randomUUID()}`;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let totalBytes = 0;
  try {
    await worker.start({
      executionId,
      command: bin,
      args,
      cwd,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      timeoutMs: COMMAND_TIMEOUT_MS,
      terminationGraceMs: 500,
      belowNormalPriority: true,
    });
    const result = await worker.subscribe(executionId, {
      onOutput: (stream, chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BUFFER) {
          void worker.cancel(executionId, "SIGKILL");
          return;
        }
        (stream === "stdout" ? stdout : stderr).push(chunk);
      },
    }).settled;
    const stdoutText = Buffer.concat(stdout).toString("utf8");
    const stderrText = Buffer.concat(stderr).toString("utf8");
    if (totalBytes > MAX_BUFFER) {
      throw new GitCommandError(
        command,
        null,
        `Git command output exceeded ${MAX_BUFFER} bytes.`,
        stdoutText,
      );
    }
    if (result.exitCode !== 0) {
      throw new GitCommandError(
        command,
        result.exitCode ?? null,
        stderrText || `${command} failed`,
        stdoutText,
      );
    }
    return { stdout: stdoutText, stderr: stderrText };
  } finally {
    void worker.remove(executionId).catch(() => undefined);
  }
}
