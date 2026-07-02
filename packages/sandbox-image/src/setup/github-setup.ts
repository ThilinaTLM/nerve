import type { SandboxConfigV1, StartupSetupStatus } from "@nervekit/shared";
export async function runGithubSetup(
  config: SandboxConfigV1,
): Promise<StartupSetupStatus> {
  if (!config.github?.enabled) return { configured: false, status: "skipped" };
  return {
    configured: true,
    status: "completed",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    limitations: ["interactive gh auth login is intentionally not used"],
  };
}
