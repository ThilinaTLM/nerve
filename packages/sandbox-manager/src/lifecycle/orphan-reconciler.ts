import type { ManagedContainerRef } from "@nervekit/shared";

export type OrphanDecision = {
  ref: ManagedContainerRef;
  action: "adopt" | "stop" | "ignore";
  reason: string;
};

export function decideOrphan(
  ref: ManagedContainerRef,
  knownSandboxIds: Set<string>,
): OrphanDecision {
  const sandboxId = ref.name?.match(/nerve-([^-]+)/)?.[1];
  return sandboxId && knownSandboxIds.has(sandboxId)
    ? { ref, action: "adopt", reason: "matching manager record" }
    : { ref, action: "ignore", reason: "no matching manager record" };
}
