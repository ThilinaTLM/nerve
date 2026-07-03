import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ManagedSandboxRecord, SandboxConfigV1 } from "@nervekit/shared";
import { sandboxConfigDigestStable } from "@nervekit/shared";
import type { ManagerState } from "../app/manager-state.js";
import { materializeSandboxConfig } from "../config/materialize-sandbox-config.js";
import {
  buildSecretPolicy,
  writeSecretPolicy,
} from "../secrets/secret-policy.js";
import { VolumeManager } from "../storage/volume-manager.js";

export async function createSandboxRecord(
  state: ManagerState,
  config: SandboxConfigV1,
  image = "nerve-sandbox:dev",
  name?: string,
): Promise<ManagedSandboxRecord> {
  const now = new Date().toISOString();
  const sandboxId = config.identity?.sandboxId ?? `sbx_${randomUUID()}`;
  const instanceId = `inst_${randomUUID()}`;
  const token = `ntok_${randomBytes(32).toString("base64url")}`;
  const volumes = await new VolumeManager(
    path.join(state.config.storageDir, "volumes"),
  ).prepare(sandboxId);
  const configDir = path.join(
    state.config.storageDir,
    "volumes",
    sandboxId,
    "config",
  );
  await mkdir(configDir, { recursive: true, mode: 0o755 });
  const configPath = path.join(configDir, "sandbox.yaml");
  const tokenPath = path.join(volumes.secrets.source ?? "", "controller-token");
  await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  const controllerUrl = `${managerWsBaseUrl(state)}/api/sandboxes/${encodeURIComponent(
    sandboxId,
  )}/ws`;
  const materializedConfig: SandboxConfigV1 = {
    ...config,
    identity: { ...config.identity, sandboxId },
    controller: {
      ...config.controller,
      websocket: {
        ...config.controller.websocket,
        url: controllerUrl,
      },
      auth: {
        type: "api_key",
        apiKey: { file: "/secrets/controller-token" },
        header: "authorization",
        scheme: "Bearer",
      },
    },
  };
  await writeFile(
    configPath,
    materializeSandboxConfig(materializedConfig),
    "utf8",
  );
  const record: ManagedSandboxRecord = {
    sandboxId,
    instanceId,
    name: name ?? config.identity?.name,
    labels: config.identity?.labels,
    backend: state.config.backend,
    image: { reference: image, sandboxSpec: "v1" },
    desiredState: "created",
    observedState: "unknown",
    configDigest: sandboxConfigDigestStable(materializedConfig),
    workspaceRef: volumes.workspace,
    stateRef: volumes.state,
    secretMountRefs: [volumes.secrets],
    configRef: {
      kind: "bind",
      source: configPath,
      target: "/etc/nerve/sandbox.yaml",
      readonly: true,
    },
    controller: { token, url: controllerUrl },
    createdAt: now,
    updatedAt: now,
  };
  await writeSecretPolicy(
    path.join(state.config.storageDir, "secret-policies"),
    buildSecretPolicy(sandboxId, materializedConfig),
  );
  await state.sandboxes.put(record);
  return record;
}

function managerWsBaseUrl(state: ManagerState): string {
  const configured = process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/^http/, "ws").replace(/\/$/, "");
  const host =
    state.config.host === "0.0.0.0" ? "127.0.0.1" : state.config.host;
  return `ws://${host}:${state.config.port}`;
}
