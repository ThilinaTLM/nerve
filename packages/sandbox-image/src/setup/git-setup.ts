import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SandboxConfigV1, StartupSetupStatus } from "@nervekit/shared";

const execFileAsync = promisify(execFile);
export async function runGitSetup(
  config: SandboxConfigV1,
  workspaceDir: string,
): Promise<StartupSetupStatus> {
  if (!config.git?.enabled) return { configured: false, status: "skipped" };
  const startedAt = new Date().toISOString();
  try {
    const identity = config.git.identity;
    if (identity?.name)
      await git(["config", "user.name", identity.name], workspaceDir);
    if (identity?.email)
      await git(["config", "user.email", identity.email], workspaceDir);
    if (config.git.safeDirectory === "workspace")
      await git(
        ["config", "--global", "--add", "safe.directory", workspaceDir],
        workspaceDir,
      );
    return {
      configured: true,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      configured: true,
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      error: {
        code: "GIT_SETUP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd, timeout: 10_000 });
}
