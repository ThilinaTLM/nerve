import type { ManagedSandboxRecord } from "@nervekit/contracts";

export function shouldPreserveRecord(record: ManagedSandboxRecord): boolean {
  return Boolean(
    record.retention?.preserveFailed && record.lifecycleState === "failed",
  );
}

export function retentionElapsed(
  record: ManagedSandboxRecord,
  now = new Date(),
): boolean {
  return Boolean(record.gcAfter && Date.parse(record.gcAfter) <= now.getTime());
}
