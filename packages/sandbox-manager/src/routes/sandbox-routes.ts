import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  ManagedSandboxRecord,
  SandboxConfigV1,
  SandboxConfigYamlResult,
  SandboxCreateAuthRefs,
  SandboxCreateConfigInput,
  SandboxLaunchConfig,
} from "@nervekit/shared";
import {
  sandboxConfigDigestStable,
  sandboxConfigV1Schema,
} from "@nervekit/shared";
import { parse as parseYaml } from "yaml";
import type { ManagerState } from "../app/manager-state.js";
import {
  applyCredentialProfiles,
  selectProfiles,
} from "../config/apply-credential-profiles.js";
import {
  materializeSandboxConfig,
  parseSandboxConfigInput,
} from "../config/materialize-sandbox-config.js";
import { normalizeSandboxLaunchConfig } from "../config/sandbox-launch-config.js";
import { dbTables } from "../db/tables.js";
import { HttpError } from "../http/errors.js";
import { buildSecretPolicy } from "../secrets/secret-policy.js";

type MaterializedSandboxConfig = {
  sandboxId: string;
  controllerUrl: string;
  config: SandboxConfigV1;
  configYaml: string;
  configDigest: string;
};

export async function previewSandboxConfigYaml(
  state: ManagerState,
  config: SandboxCreateConfigInput,
  launch?: SandboxLaunchConfig,
  auth?: SandboxCreateAuthRefs,
): Promise<SandboxConfigYamlResult> {
  const normalizedLaunch = normalizeSandboxLaunchConfig(state.config, launch, {
    preview: true,
  });
  const materialized = await materializeManagedSandboxConfig(state, config, {
    auth,
    sandboxId: normalizedLaunch.sandboxId,
  });
  return {
    sandboxId: materialized.sandboxId,
    yaml: materialized.configYaml,
    configDigest: materialized.configDigest,
    source: "preview",
  };
}

export async function getSandboxConfigYaml(
  state: ManagerState,
  sandboxId: string,
): Promise<SandboxConfigYamlResult> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");

  if (record.configRef?.source) {
    try {
      const yaml = await readFile(record.configRef.source, "utf8");
      const parsed = parseSandboxConfigInput(parseYaml(yaml));
      return {
        sandboxId: record.sandboxId,
        yaml,
        configDigest: sandboxConfigDigestStable(parsed),
        source: "config_ref",
      };
    } catch {
      // Fall through to the persisted JSON copy. The runtime config file can be
      // absent after volume cleanup or unavailable for non-local backends.
    }
  }

  const result = await state.pool.query<{ materialized_config: unknown }>(
    `select materialized_config from ${dbTables.sandboxes} where sandbox_id = $1`,
    [record.sandboxId],
  );
  const config = result.rows[0]?.materialized_config;
  if (!config)
    throw new HttpError(409, "Sandbox config is unavailable", "INVALID_STATE");
  const parsed = parseSandboxConfigInput(config);
  return {
    sandboxId: record.sandboxId,
    yaml: materializeSandboxConfig(parsed),
    configDigest: sandboxConfigDigestStable(parsed),
    source: "materialized_config",
  };
}

export async function createSandboxRecord(
  state: ManagerState,
  config: SandboxCreateConfigInput,
  launch?: SandboxLaunchConfig,
  auth?: SandboxCreateAuthRefs,
): Promise<ManagedSandboxRecord> {
  const now = new Date().toISOString();
  const normalizedLaunch = normalizeSandboxLaunchConfig(state.config, launch);
  const sandboxId = normalizedLaunch.sandboxId;
  const instanceId = `inst_${randomUUID()}`;
  const token = `ntok_${randomBytes(32).toString("base64url")}`;
  const materialized = await materializeManagedSandboxConfig(state, config, {
    auth,
    sandboxId,
  });
  const volumes = await state.volumeProvider.prepare(
    sandboxId,
    materialized.config,
  );
  const materializedVolumes =
    (await state.volumeProvider.materialize?.(sandboxId, {
      configYaml: materialized.configYaml,
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
    name: normalizedLaunch.name,
    labels: normalizedLaunch.labels,
    backend: normalizedLaunch.backend,
    resources: normalizedLaunch.resources,
    image: { reference: normalizedLaunch.image, sandboxSpec: "v1" },
    desiredState: "created",
    observedState: "unknown",
    lifecycleState: "record_created",
    lifecycleUpdatedAt: now,
    configDigest: materialized.configDigest,
    workspaceRef: materializedVolumes.workspace,
    stateRef: materializedVolumes.state,
    secretMountRefs: [materializedVolumes.secrets],
    configRef: materializedVolumes.config,
    controller: { token, url: materialized.controllerUrl },
    createdAt: now,
    updatedAt: now,
  };
  await state.secretPolicies.put(
    buildSecretPolicy(sandboxId, materialized.config),
  );
  await state.sandboxes.put(record);
  await state.pool.query(
    `update ${dbTables.sandboxes} set materialized_config = $2::jsonb where sandbox_id = $1`,
    [sandboxId, JSON.stringify(materialized.config)],
  );
  return record;
}

async function materializeManagedSandboxConfig(
  state: ManagerState,
  config: SandboxCreateConfigInput,
  options: { sandboxId: string; auth?: SandboxCreateAuthRefs },
): Promise<MaterializedSandboxConfig> {
  const requestedProfiles = selectProfiles(
    await state.credentials.list(),
    options.auth,
  );
  const controllerUrl = `${managerWsBaseUrl(state)}/api/sandboxes/${encodeURIComponent(
    options.sandboxId,
  )}/ws`;
  const withProfiles = applyCredentialProfiles(config, requestedProfiles, {
    sandboxId: options.sandboxId,
    managerHttpBaseUrl: managerHttpBaseUrl(state),
  });
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
  return {
    sandboxId: options.sandboxId,
    controllerUrl,
    config: materializedConfig,
    configYaml: materializeSandboxConfig(materializedConfig),
    configDigest: sandboxConfigDigestStable(materializedConfig),
  };
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
