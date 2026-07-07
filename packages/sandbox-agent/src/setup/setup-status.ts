import type { StartupSetupStatus } from "@nervekit/shared";
export function skippedSetupStatus(configured = false): StartupSetupStatus {
  return { configured, status: "skipped" };
}
export function completedSetupStatus(configured = true): StartupSetupStatus {
  const now = new Date().toISOString();
  return { configured, status: "completed", startedAt: now, completedAt: now };
}
