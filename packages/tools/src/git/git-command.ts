import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
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
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
    };
    const stderr = err.stderr || err.message;
    const stdout = err.stdout || "";
    const code = typeof err.code === "number" ? err.code : null;
    throw new GitCommandError(`${bin} ${args.join(" ")}`, code, stderr, stdout);
  }
}
