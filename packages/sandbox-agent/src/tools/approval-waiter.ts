import path from "node:path";
import type { SandboxApprovalWaitRecord } from "@nervekit/shared";
import { sandboxSha256Digest } from "../state/hash.js";
import { JsonlStore } from "../state/jsonl-store.js";

export type ApprovalScope = "single_call" | "same_tool_same_args" | "run";

export type ApprovalRequest = SandboxApprovalWaitRecord & {
  id: string;
  tool?: string;
  toolName?: string;
  args?: unknown;
  argsHash?: string;
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
      this.approvals.set(
        request.id ?? request.approvalId,
        normalizeApproval(request),
      );
    }
  }
  async request(
    input: Partial<ApprovalRequest> & {
      id: string;
      toolCallId?: string;
      reason?: string;
      risk?: string[];
      normalizedArgs?: unknown;
    },
  ): Promise<ApprovalRequest> {
    const existing = this.approvals.get(input.id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const request = normalizeApproval({
      ...input,
      id: input.id,
      approvalId: input.approvalId ?? input.id,
      toolCallId: input.toolCallId ?? input.id,
      conversationId: input.conversationId ?? "conv_unknown",
      agentId: input.agentId ?? "agent_main",
      runId: input.runId ?? "run_unknown",
      risk: input.risk ?? ["policy"],
      reason: input.reason ?? "approval required",
      normalizedArgs: input.normalizedArgs ?? input.args ?? {},
      displayArgs: input.displayArgs ?? input.normalizedArgs ?? input.args,
      toolName: input.toolName ?? input.tool,
      argsHash:
        input.argsHash ??
        sandboxSha256Digest(input.normalizedArgs ?? input.args ?? {}),
      status: "waiting",
      createdAt: input.createdAt ?? now,
    });
    this.approvals.set(request.id, request);
    await this.store?.append(request);
    return request;
  }
  async resolve(
    id: string,
    decision: "grant" | "deny",
    note?: string,
    options: {
      selectedScope?: ApprovalScope;
      commandId?: string;
      checkpointId?: string;
    } = {},
  ): Promise<ApprovalRequest> {
    const current = this.approvals.get(id);
    if (!current) throw new Error(`Unknown approval: ${id}`);
    const status = decision === "grant" ? "granted" : "denied";
    const selectedScope = options.selectedScope ?? "single_call";
    if (current.status === "granted" || current.status === "denied") {
      const currentDecision = current.status === "granted" ? "grant" : "deny";
      if (
        currentDecision !== decision ||
        (current.selectedScope ?? "single_call") !== selectedScope
      )
        throw new Error(`Conflicting approval resolution: ${id}`);
      return current;
    }
    if (current.status !== "waiting")
      throw new Error(`Approval already resolved: ${id}`);
    const next = normalizeApproval({
      ...current,
      status,
      selectedScope,
      resolutionCommandId: options.commandId,
      resolutionReason: note,
      checkpointId: options.checkpointId,
      appliesTo: appliesTo(current, selectedScope),
      denialError:
        decision === "deny"
          ? { code: "POLICY_DENIED", message: note ?? "Approval denied" }
          : undefined,
      resolvedAt: new Date().toISOString(),
      resolved: { decision, note, resolvedAt: new Date().toISOString() },
    });
    this.approvals.set(id, next);
    await this.store?.append(next);
    return next;
  }
  async cancelRun(scope: {
    conversationId?: string;
    agentId?: string;
    runId: string;
  }): Promise<ApprovalRequest[]> {
    const cancelled: ApprovalRequest[] = [];
    for (const approval of this.approvals.values()) {
      if (approval.status !== "waiting") continue;
      if (
        scope.conversationId &&
        approval.conversationId !== scope.conversationId
      )
        continue;
      if (scope.agentId && approval.agentId !== scope.agentId) continue;
      if (approval.runId !== scope.runId) continue;
      const next = normalizeApproval({
        ...approval,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
      });
      this.approvals.set(approval.id, next);
      await this.store?.append(next);
      cancelled.push(next);
    }
    return cancelled;
  }
  pendingForRun(scope: {
    conversationId?: string;
    agentId?: string;
    runId: string;
  }): ApprovalRequest[] {
    return this.list().filter(
      (approval) =>
        approval.status === "waiting" &&
        (!scope.conversationId ||
          approval.conversationId === scope.conversationId) &&
        (!scope.agentId || approval.agentId === scope.agentId) &&
        approval.runId === scope.runId,
    );
  }
  resolutionForToolCall(toolCallId: string): ApprovalRequest | undefined {
    return this.list().find(
      (approval) =>
        approval.toolCallId === toolCallId &&
        (approval.status === "granted" || approval.status === "denied"),
    );
  }
  resolutionForToolCallOrScope(input: {
    toolCallId: string;
    conversationId: string;
    agentId: string;
    runId: string;
    toolName: string;
    normalizedArgs: unknown;
  }): ApprovalRequest | undefined {
    const argsHash = sandboxSha256Digest(input.normalizedArgs);
    const resolved = this.list().filter(
      (approval) =>
        approval.status === "granted" || approval.status === "denied",
    );
    const exact = resolved.find(
      (approval) => approval.toolCallId === input.toolCallId,
    );
    if (exact) return exact;
    const sameToolArgs = resolved.find(
      (approval) =>
        approval.selectedScope === "same_tool_same_args" &&
        approval.conversationId === input.conversationId &&
        approval.agentId === input.agentId &&
        approval.runId === input.runId &&
        (approval.toolName ?? approval.tool) === input.toolName &&
        approval.argsHash === argsHash,
    );
    if (sameToolArgs) return sameToolArgs;
    return resolved.find(
      (approval) =>
        approval.selectedScope === "run" &&
        approval.conversationId === input.conversationId &&
        approval.agentId === input.agentId &&
        approval.runId === input.runId,
    );
  }
  list(): ApprovalRequest[] {
    return Array.from(this.approvals.values());
  }
}

function appliesTo(approval: ApprovalRequest, scope: ApprovalScope): string[] {
  if (scope === "single_call") return [approval.toolCallId];
  if (scope === "same_tool_same_args")
    return [
      `run:${approval.conversationId}/${approval.agentId}/${approval.runId}:tool:${approval.toolName ?? approval.tool ?? "unknown"}:args:${approval.argsHash ?? "unknown"}`,
    ];
  return [
    `run:${approval.conversationId}/${approval.agentId}/${approval.runId}`,
  ];
}

function normalizeApproval(
  input: Partial<ApprovalRequest> & { id?: string; approvalId?: string },
): ApprovalRequest {
  const approvalId = input.approvalId ?? input.id ?? `approval_${Date.now()}`;
  return {
    id: input.id ?? approvalId,
    approvalId,
    toolCallId: input.toolCallId ?? approvalId,
    conversationId: input.conversationId ?? "conv_unknown",
    agentId: input.agentId ?? "agent_main",
    runId: input.runId ?? "run_unknown",
    risk: input.risk ?? ["policy"],
    reason: input.reason ?? "approval required",
    normalizedArgs: input.normalizedArgs ?? {},
    displayArgs: input.displayArgs,
    status: input.status ?? "waiting",
    selectedScope: input.selectedScope,
    resolutionCommandId: input.resolutionCommandId,
    resolutionReason: input.resolutionReason,
    appliesTo: input.appliesTo,
    checkpointId: input.checkpointId,
    denialError: input.denialError,
    createdAt: input.createdAt ?? new Date().toISOString(),
    resolvedAt: input.resolvedAt,
    cancelledAt: input.cancelledAt,
    tool: input.tool,
    toolName: input.toolName,
    args: input.args,
    argsHash:
      input.argsHash ??
      sandboxSha256Digest(input.normalizedArgs ?? input.args ?? {}),
    resolved: input.resolved,
  };
}
