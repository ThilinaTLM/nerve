import os from "node:os";
import path from "node:path";
export type ManagerConfig = {
  host: string;
  port: number;
  allowRemoteBind: boolean;
  storageDir: string;
  apiKey?: string;
  backend: "docker" | "podman";
};
export function loadManagerConfig(env = process.env): ManagerConfig {
  const host = env.NERVE_SANDBOX_MANAGER_HOST?.trim() || "127.0.0.1";
  const allowRemoteBind =
    env.NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND === "1" ||
    env.NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND === "true";
  if (!allowRemoteBind && !["127.0.0.1", "localhost", "::1"].includes(host))
    throw new Error(
      "Refusing remote bind without NERVE_SANDBOX_MANAGER_ALLOW_REMOTE_BIND=true",
    );
  return {
    host,
    port: Number(env.NERVE_SANDBOX_MANAGER_PORT ?? 7869),
    allowRemoteBind,
    storageDir:
      env.NERVE_SANDBOX_MANAGER_STORAGE_DIR?.trim() ||
      path.join(os.homedir(), ".nerve", "sandbox-manager"),
    apiKey: env.NERVE_SANDBOX_MANAGER_API_KEY,
    backend:
      env.NERVE_SANDBOX_MANAGER_BACKEND === "podman" ? "podman" : "docker",
  };
}
