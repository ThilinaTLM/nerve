import type { ManagedContainerRef } from "@nervekit/contracts";
import type { ContainerRuntimeDriver } from "../drivers/container-runtime-driver.js";
import type { ManagerStore } from "../state/manager-store.js";

export type OrphanDecision = {
  ref: ManagedContainerRef;
  action: "adopt" | "stop" | "remove" | "ignore";
  reason: string;
};

export function decideOrphan(
  ref: ManagedContainerRef,
  knownSandboxIds: Set<string>,
  policy: "adopt" | "stop" | "remove" | "ignore" = "stop",
): OrphanDecision {
  const sandboxId = sandboxIdFromRef(ref);
  if (sandboxId && knownSandboxIds.has(sandboxId))
    return { ref, action: "adopt", reason: "matching manager record" };
  if (policy === "ignore")
    return { ref, action: "ignore", reason: "development ignore policy" };
  return { ref, action: policy, reason: "unmanaged sandbox container" };
}

export class OrphanReconciler {
  constructor(
    private readonly store: ManagerStore,
    private readonly driver: ContainerRuntimeDriver,
  ) {}
  async reconcile(
    refs: ManagedContainerRef[],
    policy: "adopt" | "stop" | "remove" | "ignore" = "stop",
  ): Promise<OrphanDecision[]> {
    const records = await this.store.list();
    const known = new Set(records.map((record) => record.sandboxId));
    const decisions = refs.map((ref) => decideOrphan(ref, known, policy));
    for (const decision of decisions) {
      if (decision.action === "stop")
        await this.driver.stop(decision.ref).catch(() => undefined);
      if (decision.action === "remove")
        await this.driver
          .remove(decision.ref, { force: true })
          .catch(() => undefined);
      if (decision.action === "adopt") {
        const sandboxId = sandboxIdFromRef(decision.ref);
        const record = records.find((entry) => entry.sandboxId === sandboxId);
        if (record) {
          const now = new Date().toISOString();
          await this.store.put({
            ...record,
            containerRef: decision.ref,
            observedState: "running",
            lifecycleState:
              record.lifecycleState === "ready" ||
              record.lifecycleState === "degraded" ||
              record.lifecycleState === "booting" ||
              record.lifecycleState === "daemon_connected"
                ? record.lifecycleState
                : "container_started",
            lifecycleUpdatedAt: record.lifecycleUpdatedAt ?? now,
            updatedAt: now,
          });
        }
      }
    }
    return decisions;
  }
}

function sandboxIdFromRef(ref: ManagedContainerRef): string | undefined {
  const metadataSandboxId = ref.metadata?.sandboxId;
  if (metadataSandboxId) return metadataSandboxId;
  return ref.name?.match(/^nerve-([^-]+)/)?.[1];
}
