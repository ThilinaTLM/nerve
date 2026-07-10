import { createHash } from "node:crypto";
import { sandboxManagerStatusSchema } from "@nervekit/contracts";
import type { ManagerState } from "../app/manager-state.js";
import { sandboxManagerVersion } from "../app/version.js";

export async function managerStatus(state: ManagerState): Promise<unknown> {
  const runtime = await state.driver.capabilities();
  const backends = await state.driver.backendOptions?.();
  const mode = state.config.mode ?? "development";
  const encryptionAtRest = state.config.encryptionKey
    ? "enabled"
    : state.config.allowCleartextSecretsInDevelopment
      ? "development_cleartext"
      : mode === "production"
        ? "unavailable"
        : "unknown";
  return sandboxManagerStatusSchema.parse({
    managerId: managerId(state),
    version: sandboxManagerVersion,
    backend: runtime.available ? runtime.kind : state.config.backend,
    runtime,
    backends,
    hardening: {
      mode,
      apiAuth: state.config.apiKey ? "configured" : "disabled",
      secretStorage: {
        encryptionAtRest,
        keyId: state.config.encryptionKeyRef,
        warning:
          encryptionAtRest === "unavailable"
            ? "Secret encryption key is not configured"
            : encryptionAtRest === "development_cleartext"
              ? "Development cleartext secret storage is enabled"
              : undefined,
      },
    },
    lifecycle: {
      reconcileOnStartup: state.config.reconcileOnStartup ?? true,
      reconcileIntervalMs: state.config.reconcileIntervalMs,
      gcIntervalMs: state.config.gcIntervalMs,
      orphanPolicy: state.config.orphanPolicy ?? "stop_remove",
      heartbeatTimeoutMs: state.config.heartbeatTimeoutMs ?? 45_000,
      containerStartTimeoutMs: state.config.containerStartTimeoutMs,
      daemonConnectTimeoutMs: state.config.daemonConnectTimeoutMs,
      bootReadyTimeoutMs: state.config.bootReadyTimeoutMs,
      bootStallTimeoutMs: state.config.bootStallTimeoutMs,
      maxPendingCommands: state.config.maxPendingCommands ?? 256,
      maxCommandBytes: state.config.maxCommandBytes ?? 1_000_000,
    },
    updatedAt: new Date().toISOString(),
  });
}

function managerId(state: ManagerState): string {
  return `mgr_${createHash("sha256")
    .update(`${state.config.backend}:${state.config.storageDir}`)
    .digest("hex")
    .slice(0, 16)}`;
}
