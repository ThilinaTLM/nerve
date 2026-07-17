import { readFile } from "node:fs/promises";
import {
  type ManagedSandboxRecord,
  type OperationParams,
  type SandboxConfigV1,
  sandboxConfigDigestStable,
  sandboxContainerLogsResultSchema,
  sandboxRuntimeContainerStatusSchema,
  sandboxStatusGetResultSchema,
} from "@nervekit/contracts";
import { parse as parseYaml } from "yaml";
import type { ManagerState } from "../app/manager-state.js";
import {
  materializeSandboxConfig,
  parseSandboxConfigInput,
} from "../config/materialize-sandbox-config.js";
import { buildSandboxLaunchSpec } from "../config/sandbox-launch-spec.js";
import { dbTables } from "../db/tables.js";
import { recordManagerLifecycleEvent } from "../events/manager-events.js";
import { HttpError } from "../http/errors.js";
import {
  lifecycleSummary,
  transitionSandboxLifecycle,
} from "../lifecycle/lifecycle-state.js";
import { LogCollector } from "../lifecycle/log-collector.js";
import { refreshSandboxObservedState } from "../lifecycle/reconciler.js";
import {
  createSandboxRecord,
  getSandboxConfigYaml,
} from "../routes/sandbox-routes.js";
import {
  readAgentStateSummary,
  setupSummaryFailure,
} from "../state/agent-state-summary.js";
import {
  deriveSandboxContainerStatus,
  managerDerivedSandboxView,
} from "./manager-derived-sandbox-view.js";
import type { SandboxWsServer } from "./sandbox-ws-server.js";

export async function createManagedSandbox(
  state: ManagerState,
  params: OperationParams<"sandbox.create">,
): Promise<ManagedSandboxRecord> {
  const record = await createSandboxRecord(
    state,
    params.config,
    params.launch,
    params.auth,
  );
  await recordManagerLifecycleEvent(state, {
    type: "sandbox.lifecycle.changed",
    sandboxId: record.sandboxId,
    payload: {
      sandboxId: record.sandboxId,
      current: record.lifecycleState,
      changedAt: record.lifecycleUpdatedAt,
      reason: "created",
    },
  });
  try {
    return await startManagedSandbox(state, record.sandboxId);
  } catch (error) {
    const failed = await state.sandboxes.get(record.sandboxId);
    if (failed?.lifecycleState !== "failed") throw error;
    return publicSandboxRecord(failed);
  }
}

export async function listManagedSandboxes(state: ManagerState) {
  const records = await Promise.all(
    (await state.sandboxes.list()).map(async (record) =>
      recoverStartupFailureFromAgentState(
        state,
        await refreshSandboxObservedState(
          state.sandboxes,
          state.driver,
          record,
        ),
      ),
    ),
  );
  return records.map((record) => ({
    ...publicSandboxRecord(record),
    activity: state.activity.get(record.sandboxId),
  }));
}

export async function getManagedSandbox(
  state: ManagerState,
  sandboxId: string,
) {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  return publicSandboxRecord(
    await recoverStartupFailureFromAgentState(
      state,
      await refreshSandboxObservedState(state.sandboxes, state.driver, record),
    ),
  );
}

export async function startManagedSandbox(
  state: ManagerState,
  sandboxId: string,
): Promise<ManagedSandboxRecord> {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  const config = await loadSandboxConfigForStart(state, record);
  const refreshed = (await state.sandboxes.get(sandboxId)) ?? record;
  const runtimeVolumes = (await state.volumeStore.get(sandboxId)) ?? {
    workspace: refreshed.workspaceRef,
    state: refreshed.stateRef,
    secrets: refreshed.secretMountRefs?.[0],
    config: refreshed.configRef,
    tmp: undefined,
  };
  if (!runtimeVolumes.secrets || !runtimeVolumes.config)
    throw new HttpError(
      409,
      "Sandbox runtime volumes are not materialized for this container backend",
      "INVALID_STATE",
    );
  const spec = buildSandboxLaunchSpec(config, {
    image: refreshed.image.reference,
    sandboxId,
    managerBaseUrl: refreshed.controller?.url ?? "",
    runtimeMounts: {
      workspace: runtimeVolumes.workspace,
      state: runtimeVolumes.state,
      config: runtimeVolumes.config,
      secrets: runtimeVolumes.secrets,
      tmp: runtimeVolumes.tmp,
    },
    backend: refreshed.backend,
    labels: refreshed.labels,
    resources: refreshed.resources,
    logLevel: state.config.logLevel,
  });
  const stableInstanceId = record.instanceId ?? spec.instanceId;
  return publicSandboxRecord(
    await state.supervisor.start(sandboxId, {
      ...spec,
      instanceId: stableInstanceId,
      env: { ...spec.env, NERVE_SANDBOX_AGENT_INSTANCE_ID: stableInstanceId },
      labels: {
        ...spec.labels,
        "org.nerve.sandbox.instance": stableInstanceId,
      },
    }),
  );
}

export async function stopManagedSandbox(
  state: ManagerState,
  sandboxId: string,
) {
  return publicSandboxRecord(await state.supervisor.stop(sandboxId));
}

/**
 * Restart intentionally reuses the sandbox's state volume (`stateRef`), so
 * conversations, run history, and recovered agent state survive the restart.
 * Remove + recreate the sandbox to get a clean slate.
 */
export async function restartManagedSandbox(
  state: ManagerState,
  sandboxId: string,
) {
  await state.supervisor.stop(sandboxId).catch(() => undefined);
  return startManagedSandbox(state, sandboxId);
}

export async function removeManagedSandbox(
  state: ManagerState,
  params: OperationParams<"sandbox.remove">,
) {
  const removed = await state.supervisor.remove(params.sandboxId, params);
  await state.sandboxes.delete(params.sandboxId);
  if (params.removeVolumes)
    await state.volumeProvider.remove?.(params.sandboxId, params);
  await recordManagerLifecycleEvent(state, {
    type: "sandbox.lifecycle.changed",
    sandboxId: params.sandboxId,
    payload: {
      sandboxId: params.sandboxId,
      current: "removed",
      changedAt: new Date().toISOString(),
      reason: "deleted",
    },
  });
  return publicSandboxRecord(removed);
}

export async function managedSandboxConfig(
  state: ManagerState,
  sandboxId: string,
) {
  return getSandboxConfigYaml(state, sandboxId);
}

export async function managedSandboxStatus(
  state: ManagerState,
  controller: SandboxWsServer,
  sandboxId: string,
) {
  const session = controller.getSession(sandboxId);
  if (session) {
    const result = await session.forwarder.send(
      session.socket,
      "sandbox.status.get",
      { sandboxId },
    );
    return sandboxStatusGetResultSchema.parse({
      connected: true,
      stale: false,
      lifecycle: await connectedLifecycle(state, sandboxId),
      container: await managedContainerStatus(state, sandboxId),
      ...(isRecord(result) ? result : {}),
    });
  }
  const view = await managerDerivedSandboxView(state, sandboxId);
  if (!view) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  return sandboxStatusGetResultSchema.parse(view.status);
}

export async function managedContainerStatus(
  state: ManagerState,
  sandboxId: string,
) {
  const record = await state.sandboxes.get(sandboxId);
  if (!record) throw new HttpError(404, "Sandbox not found", "NOT_FOUND");
  return sandboxRuntimeContainerStatusSchema.parse(
    (await deriveSandboxContainerStatus(state, record)).container,
  );
}

export async function managedContainerLogs(
  state: ManagerState,
  params: OperationParams<"sandbox.container.logs.get">,
) {
  const record = await state.sandboxes.get(params.sandboxId);
  if (!record?.containerRef)
    return sandboxContainerLogsResultSchema.parse({
      chunks: [],
      truncated: false,
      available: false,
      limitations: ["No container has been created for this sandbox"],
    });
  const collector = new LogCollector(state.driver);
  const chunks: Array<{ stream: string; chunk: string; ts?: string }> = [];
  let bytes = 0;
  let truncated = false;
  try {
    for await (const chunk of collector.logs(record.containerRef, {
      tail: params.tail,
      since: params.since,
    })) {
      const redacted = redactText(chunk.chunk);
      bytes += Buffer.byteLength(redacted);
      if (bytes > 256 * 1024) {
        truncated = true;
        break;
      }
      chunks.push({ ...chunk, chunk: redacted });
    }
  } catch (error) {
    return sandboxContainerLogsResultSchema.parse({
      chunks,
      truncated,
      available: false,
      limitations: [
        redactText(error instanceof Error ? error.message : String(error)),
      ],
    });
  }
  return sandboxContainerLogsResultSchema.parse({
    chunks,
    truncated,
    available: true,
  });
}

async function loadSandboxConfigForStart(
  state: ManagerState,
  record: ManagedSandboxRecord,
): Promise<SandboxConfigV1> {
  if (record.configRef?.source) {
    try {
      const config = parseSandboxConfigInput(
        parseYaml(await readFile(record.configRef.source, "utf8")),
      );
      if (sandboxConfigDigestStable(config) === record.configDigest)
        return config;
      await rematerializeSandboxConfig(state, record, config);
      return config;
    } catch {
      // Regenerate runtime materialization from PostgreSQL below.
    }
  }
  const result = await state.pool.query<{ materialized_config: unknown }>(
    `select materialized_config from ${dbTables.sandboxes} where sandbox_id = $1`,
    [record.sandboxId],
  );
  const config = parseSandboxConfigInput(result.rows[0]?.materialized_config);
  await rematerializeSandboxConfig(state, record, config);
  return config;
}

async function rematerializeSandboxConfig(
  state: ManagerState,
  record: ManagedSandboxRecord,
  config: SandboxConfigV1,
): Promise<void> {
  await state.pool.query(
    `update ${dbTables.sandboxes} set materialized_config = $2::jsonb where sandbox_id = $1`,
    [record.sandboxId, JSON.stringify(config)],
  );
  const materialized = await state.volumeProvider.materialize?.(
    record.sandboxId,
    {
      configYaml: materializeSandboxConfig(config),
      controllerToken: record.controller?.token ?? "",
    },
  );
  if (!materialized) return;
  await state.volumeStore.put(
    record.sandboxId,
    state.volumeProvider.kind,
    materialized,
  );
  await state.sandboxes.put({
    ...record,
    workspaceRef: materialized.workspace,
    stateRef: materialized.state,
    secretMountRefs: [materialized.secrets],
    configDigest: sandboxConfigDigestStable(config),
    configRef: materialized.config,
  });
}

async function recoverStartupFailureFromAgentState(
  state: ManagerState,
  record: ManagedSandboxRecord,
): Promise<ManagedSandboxRecord> {
  if (record.lifecycleState === "failed") return record;
  const summary = await readAgentStateSummary(record);
  const failure =
    summary?.startupFailure?.error ?? setupSummaryFailure(summary?.setup);
  if (!failure) return record;
  return transitionSandboxLifecycle(
    {
      store: state.sandboxes,
      recordEvent: (event) => recordManagerLifecycleEvent(state, event),
    },
    record.sandboxId,
    "failed",
    {
      observedState: "failed",
      lastError: { code: failure.code, message: failure.message },
      reason: failure.code,
      force: true,
    },
  );
}

export function publicSandboxRecord(
  record: ManagedSandboxRecord,
): ManagedSandboxRecord {
  return record.controller
    ? { ...record, controller: { ...record.controller, token: "[REDACTED]" } }
    : record;
}

async function connectedLifecycle(state: ManagerState, sandboxId: string) {
  const record = await state.sandboxes.get(sandboxId);
  return record ? lifecycleSummary(record) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactText(value: string): string {
  return value.replace(
    /(token|secret|password|api[_-]?key)=\S+/gi,
    "$1=[REDACTED]",
  );
}
