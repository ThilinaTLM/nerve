import { randomUUID } from "node:crypto";
import type { ManagedSandboxRecord, SandboxConfigV1 } from "@nervekit/shared";
import { sandboxConfigDigestStable } from "@nervekit/shared";
import type { ManagerState } from "../app/manager-state.js";
export async function createSandboxRecord(
  state: ManagerState,
  config: SandboxConfigV1,
  image = "nerve-sandbox:dev",
): Promise<ManagedSandboxRecord> {
  const now = new Date().toISOString();
  const sandboxId = config.identity?.sandboxId ?? `sbx_${randomUUID()}`;
  const record: ManagedSandboxRecord = {
    sandboxId,
    name: config.identity?.name,
    labels: config.identity?.labels,
    backend: state.config.backend,
    image: { reference: image, sandboxSpec: "v1" },
    desiredState: "created",
    observedState: "unknown",
    configDigest: sandboxConfigDigestStable(config),
    workspaceRef: {
      kind: "bind",
      source: `${state.config.storageDir}/volumes/${sandboxId}/workspace`,
      target: "/workspace",
    },
    stateRef: {
      kind: "bind",
      source: `${state.config.storageDir}/volumes/${sandboxId}/state`,
      target: "/state",
    },
    createdAt: now,
    updatedAt: now,
  };
  await state.sandboxes.put(record);
  return record;
}
