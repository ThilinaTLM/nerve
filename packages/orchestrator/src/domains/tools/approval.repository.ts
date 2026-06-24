import { join } from "node:path";
import type { ApprovalRecord } from "@nervekit/shared";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import {
  appendJsonLine,
  type InitializedStorage,
  readJsonLines,
  rewriteJsonLines,
} from "../../infrastructure/storage/index.js";

export class ApprovalRepository {
  readonly records = new Map<string, ApprovalRecord>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<void> {
    for (const approval of await this.readLatest()) {
      this.records.set(approval.id, approval);
      this.index.upsertApproval(approval);
    }
  }

  list(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return [...this.records.values()]
      .filter((approval) => !status || approval.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  getPending(approvalId: string): ApprovalRecord {
    const approval = this.records.get(approvalId);
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending") {
      throw new Error("Approval is already resolved.");
    }
    return approval;
  }

  async upsert(approval: ApprovalRecord): Promise<void> {
    this.records.set(approval.id, approval);
    this.index.upsertApproval(approval);
    await appendJsonLine(this.path(), approval, 0o600);
  }

  async removeForConversations(conversationIds: Set<string>): Promise<void> {
    for (const [id, approval] of this.records) {
      if (conversationIds.has(approval.conversationId)) {
        this.records.delete(id);
        this.index.deleteApproval(id);
      }
    }
    await rewriteJsonLines(this.path(), this.list(), 0o600);
  }

  private async readLatest(): Promise<ApprovalRecord[]> {
    const values = await readJsonLines<ApprovalRecord>(this.path()).catch(
      () => [],
    );
    return latestById(values);
  }

  private path(): string {
    return join(this.storage.paths.home, "approvals", "approvals.jsonl");
  }
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}
