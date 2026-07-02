import path from "node:path";
import { JsonlStore } from "../state/jsonl-store.js";

export type ApprovalRequest = {
  id: string;
  runId?: string;
  tool?: string;
  args?: unknown;
  toolCallId?: string;
  reason?: string;
  risk?: string[];
  normalizedArgs?: unknown;
  createdAt: string;
  resolved?: { decision: "grant" | "deny"; note?: string; resolvedAt: string };
};

export class ApprovalWaiter {
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly store?: JsonlStore<ApprovalRequest>;
  constructor(stateDir?: string) {
    this.store = stateDir
      ? new JsonlStore(path.join(stateDir, "waits", "approvals.jsonl"))
      : undefined;
  }
  async load(): Promise<void> {
    if (!this.store) return;
    this.approvals.clear();
    for (const request of await this.store.readAll()) {
      this.approvals.set(request.id, request);
    }
  }
  async request(
    input: Omit<ApprovalRequest, "createdAt">,
  ): Promise<ApprovalRequest> {
    const existing = this.approvals.get(input.id);
    if (existing) return existing;
    const request = { ...input, createdAt: new Date().toISOString() };
    this.approvals.set(request.id, request);
    await this.store?.append(request);
    return request;
  }
  async resolve(
    id: string,
    decision: "grant" | "deny",
    note?: string,
  ): Promise<ApprovalRequest> {
    const current = this.approvals.get(id);
    if (!current) throw new Error(`Unknown approval: ${id}`);
    if (current.resolved) {
      if (current.resolved.decision !== decision)
        throw new Error(`Conflicting approval resolution: ${id}`);
      return current;
    }
    const next = {
      ...current,
      resolved: { decision, note, resolvedAt: new Date().toISOString() },
    };
    this.approvals.set(id, next);
    await this.store?.append(next);
    return next;
  }
  list(): ApprovalRequest[] {
    return Array.from(this.approvals.values());
  }
}
