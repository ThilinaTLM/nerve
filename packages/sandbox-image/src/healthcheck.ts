import { type HealthStatus, readRuntimeHealth } from "./runtime/status.js";

export type SandboxHealthcheckResult = HealthStatus & {
  component: "nerve-sandbox";
};

export async function sandboxHealthcheck(): Promise<SandboxHealthcheckResult> {
  return { ...(await readRuntimeHealth()), component: "nerve-sandbox" };
}
