import { randomBytes, randomUUID } from "node:crypto";
import type {
  ManagedSandboxRecord,
  SandboxConfigV1,
  SandboxCreateAuthRefs,
  SandboxCreateConfigInput,
} from "@nervekit/shared";
import {
  sandboxConfigDigestStable,
  sandboxConfigV1Schema,
} from "@nervekit/shared";
import type { ManagerState } from "../app/manager-state.js";
import {
  applyCredentialProfiles,
  selectProfiles,
} from "../config/apply-credential-profiles.js";
import { materializeSandboxConfig } from "../config/materialize-sandbox-config.js";
import { buildSecretPolicy } from "../secrets/secret-policy.js";

export async function createSandboxRecord(
  state: ManagerState,
  config: SandboxCreateConfigInput,
  image = "nerve-sandbox-agent:dev",
  name?: string,
  auth?: SandboxCreateAuthRefs,
): Promise<ManagedSandboxRecord> {
  const now = new Date().toISOString();
  const sandboxId = config.identity?.sandboxId ?? `sbx_${randomUUID()}`;
  const instanceId = `inst_${randomUUID()}`;
  const token = `ntok_${randomBytes(32).toString("base64url")}`;
  const requestedProfiles = selectProfiles(
    await state.credentials.list(),
    auth,
  );
  const controllerUrl = `${managerWsBaseUrl(state)}/api/sandboxes/${encodeURIComponent(
    sandboxId,
  )}/ws`;
  const withProfiles = applyCredentialProfiles(
    { ...config, identity: { ...config.identity, sandboxId } },
    requestedProfiles,
    { sandboxId, managerHttpBaseUrl: managerHttpBaseUrl(state) },
  );
  const materializedConfig: SandboxConfigV1 = sandboxConfigV1Schema.parse({
    ...withProfiles,
    controller: {
      ...withProfiles.controller,
      websocket: {
        ...withProfiles.controller?.websocket,
        url: controllerUrl,
      },
      auth: {
        type: "api_key",
        apiKey: { file: "/secrets/controller-token" },
        header: "authorization",
        scheme: "Bearer",
      },
    },
  });
  const configYaml = materializeSandboxConfig(materializedConfig);
  const volumes = await state.volumeProvider.prepare(
    sandboxId,
    materializedConfig,
  );
  const materializedVolumes =
    (await state.volumeProvider.materialize?.(sandboxId, {
      configYaml,
      controllerToken: token,
    })) ?? volumes;
  await state.volumeStore.put(
    sandboxId,
    state.volumeProvider.kind,
    materializedVolumes,
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
    workspaceRef: materializedVolumes.workspace,
    stateRef: materializedVolumes.state,
    secretMountRefs: [materializedVolumes.secrets],
    configRef: materializedVolumes.config,
    controller: { token, url: controllerUrl },
    createdAt: now,
    updatedAt: now,
  };
  await state.secretPolicies.put(
    buildSecretPolicy(sandboxId, materializedConfig),
  );
  await state.sandboxes.put(record);
  await state.pool.query(
    "update sandboxes set materialized_config = $2::jsonb where sandbox_id = $1",
    [sandboxId, JSON.stringify(materializedConfig)],
  );
  return record;
}

function managerHttpBaseUrl(state: ManagerState): string {
  const configured = process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/^ws/, "http").replace(/\/$/, "");
  const host =
    state.config.host === "0.0.0.0" ? "127.0.0.1" : state.config.host;
  return `http://${host}:${state.config.port}`;
}

function managerWsBaseUrl(state: ManagerState): string {
  const configured = process.env.NERVE_SANDBOX_MANAGER_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/^http/, "ws").replace(/\/$/, "");
  const host =
    state.config.host === "0.0.0.0" ? "127.0.0.1" : state.config.host;
  return `ws://${host}:${state.config.port}`;
}
