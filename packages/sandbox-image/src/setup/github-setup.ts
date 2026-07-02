import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1, StartupSetupStatus } from "@nervekit/shared";

export async function runGithubSetup(
  config: SandboxConfigV1,
  credentialsDir = "/state/credentials",
): Promise<StartupSetupStatus> {
  if (!config.github?.enabled) return { configured: false, status: "skipped" };
  const startedAt = new Date().toISOString();
  try {
    await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(credentialsDir, "github-askpass.sh"),
      "#!/bin/sh\necho $" + "{GITHUB_TOKEN:-}\n",
      { mode: 0o700 },
    );
    return {
      configured: true,
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      limitations: ["interactive gh auth login is intentionally not used"],
    };
  } catch (error) {
    return {
      configured: true,
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      error: {
        code: "GITHUB_SETUP_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
