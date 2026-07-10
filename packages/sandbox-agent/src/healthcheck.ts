import { type HealthStatus, readRuntimeHealth } from "./runtime/status.js";

export type SandboxHealthcheckResult = HealthStatus & {
  component: "nerve-sandbox-agent";
};

export async function sandboxHealthcheck(): Promise<SandboxHealthcheckResult> {
  return { ...(await readRuntimeHealth()), component: "nerve-sandbox-agent" };
}
