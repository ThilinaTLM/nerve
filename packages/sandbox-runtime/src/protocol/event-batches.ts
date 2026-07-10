import type { SandboxOutboxRecord } from "@nervekit/contracts";
export function makeEventBatch(events: SandboxOutboxRecord[]): {
  batchId: string;
  events: SandboxOutboxRecord[];
} {
  return { batchId: `batch_${Date.now()}_${events.at(-1)?.seq ?? 0}`, events };
}
