import type { ManagedSandboxRecord } from "@nervekit/shared";
import type { ManagerStore } from "../state/manager-store.js";

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
      const decision = await this.evaluate(record, now);
      decisions.push(decision);
      if (decision.action === "remove_record") {
        await this.store.delete(record.sandboxId);
      }
    }
    return decisions;
  }

  private async evaluate(
    record: ManagedSandboxRecord,
    now: Date,
  ): Promise<GarbageCollectionDecision> {
    if (!record.gcAfter) return { sandboxId: record.sandboxId, action: "none" };
    if (record.retention?.preserveFailed && record.observedState === "failed") {
      return { sandboxId: record.sandboxId, action: "none" };
    }
    if (Date.parse(record.gcAfter) <= now.getTime()) {
      return {
        sandboxId: record.sandboxId,
        action: "remove_record",
        reason: "gcAfter elapsed",
      };
    }
    return { sandboxId: record.sandboxId, action: "none" };
  }
}
