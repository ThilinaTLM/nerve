import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveSandboxRuntimePaths } from "../state/state-layout.js";

export type HealthStatus = {
  healthy: boolean;
  status: string;
  checks: Record<string, boolean>;
  details?: Record<string, unknown>;
};

export async function readRuntimeHealth(
  env = process.env,
): Promise<HealthStatus> {
  const paths = resolveSandboxRuntimePaths(env);
  const checks: Record<string, boolean> = {};
  checks.state = await exists(paths.stateDir);
  checks.configDigest = await exists(path.join(paths.configDir, "digest.txt"));
  checks.status = await exists(path.join(paths.stateDir, "status.json"));
  checks.lock = await exists(path.join(paths.stateDir, "lock"));
  let status = "unknown";
  try {
    status = String(
      JSON.parse(
        await readFile(path.join(paths.stateDir, "status.json"), "utf8"),
      ).status ?? "unknown",
    );
  } catch {
    // Leave status unknown when the status file cannot be read.
  }
  const healthy =
    checks.state &&
    checks.configDigest &&
    ["ready", "degraded", "running", "reconnecting"].includes(status);
  return { healthy, status, checks };
}
async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}
