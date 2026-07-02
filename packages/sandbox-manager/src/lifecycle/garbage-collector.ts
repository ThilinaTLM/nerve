import type { ManagedSandboxRecord } from "@nervekit/shared";
import type { ManagerStore } from "../state/manager-store.js";
import { retentionElapsed, shouldPreserveRecord } from "./retention-policy.js";

export type GarbageCollectionDecision = {
  sandboxId: string;
  action: "none" | "remove_record";
  reason?: string;
};

export class SandboxGarbageCollector {
  constructor(private readonly store: ManagerStore) {}

  async collect(now = new Date()): Promise<GarbageCollectionDecision[]> {
    const decisions: GarbageCollectionDecision[] = [];
    for (const record of await this.store.list()) {
      const decision = this.evaluate(record, now);
      decisions.push(decision);
      if (decision.action === "remove_record") {
        await this.store.delete(record.sandboxId);
      }
    }
    return decisions;
  }

  private evaluate(
    record: ManagedSandboxRecord,
    now: Date,
  ): GarbageCollectionDecision {
    if (!record.gcAfter) return { sandboxId: record.sandboxId, action: "none" };
    if (shouldPreserveRecord(record)) {
      return { sandboxId: record.sandboxId, action: "none" };
    }
    if (retentionElapsed(record, now)) {
      return {
        sandboxId: record.sandboxId,
        action: "remove_record",
        reason: "gcAfter elapsed",
      };
    }
    return { sandboxId: record.sandboxId, action: "none" };
  }
}
