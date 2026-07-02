export type ApprovalRequest = {
  id: string;
  runId: string;
  tool: string;
  args: unknown;
  createdAt: string;
  resolved?: { decision: "grant" | "deny"; note?: string; resolvedAt: string };
};
export class ApprovalWaiter {
  private readonly approvals = new Map<string, ApprovalRequest>();
  request(input: Omit<ApprovalRequest, "createdAt">): ApprovalRequest {
    const request = { ...input, createdAt: new Date().toISOString() };
    this.approvals.set(request.id, request);
    return request;
  }
  resolve(
    id: string,
    decision: "grant" | "deny",
    note?: string,
  ): ApprovalRequest {
    const current = this.approvals.get(id);
    if (!current) throw new Error(`Unknown approval: ${id}`);
    const next = {
      ...current,
      resolved: { decision, note, resolvedAt: new Date().toISOString() },
    };
    this.approvals.set(id, next);
    return next;
  }
  list(): ApprovalRequest[] {
    return Array.from(this.approvals.values());
  }
}
