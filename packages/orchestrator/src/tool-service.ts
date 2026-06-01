import { join } from "node:path";
import type {
  AgentRecord,
  ApprovalRecord,
  ToolCallRecord,
  ToolName,
} from "@nerve/shared";
import { createId } from "@nerve/shared";
import { coreToolDescriptors, executeTool } from "@nerve/tools";
import type { EventBus } from "./events.js";
import type { IndexStore } from "./index-store.js";
import { evaluateToolPolicy } from "./policy.js";
import type { InitializedStorage } from "./storage.js";
import { appendJsonLine, readJsonLines } from "./storage.js";

export interface ToolExecutionResponse {
  toolCall: ToolCallRecord;
  approval?: ApprovalRecord;
}

export class ToolService {
  readonly toolCalls = new Map<string, ToolCallRecord>();
  readonly approvals = new Map<string, ApprovalRecord>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<void> {
    for (const toolCall of await this.readLatestToolCalls()) {
      this.toolCalls.set(toolCall.id, toolCall);
      this.index.upsertToolCall(toolCall);
    }
    for (const approval of await this.readLatestApprovals()) {
      this.approvals.set(approval.id, approval);
      this.index.upsertApproval(approval);
    }
  }

  listTools() {
    return coreToolDescriptors;
  }

  listToolCalls(): ToolCallRecord[] {
    return [...this.toolCalls.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  listApprovals(status?: ApprovalRecord["status"]): ApprovalRecord[] {
    return [...this.approvals.values()]
      .filter((approval) => !status || approval.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async requestTool(
    agent: AgentRecord,
    toolName: ToolName,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResponse> {
    const now = new Date().toISOString();
    const evaluation = evaluateToolPolicy(agent, toolName, args, {
      dataDir: this.storage.paths.home,
    });
    const toolCall: ToolCallRecord = {
      id: createId("tool"),
      agentId: agent.id,
      sessionId: agent.sessionId,
      projectId: agent.projectId,
      toolName,
      risk: evaluation.risk,
      args: evaluation.normalizedArgs,
      cwd: evaluation.cwd,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    };
    await this.upsertToolCall(toolCall);
    await this.events.publish("agent.tool_call.requested", { toolCall });
    await this.events.publish("policy.evaluated", {
      toolCallId: toolCall.id,
      agentId: agent.id,
      sessionId: agent.sessionId,
      projectId: agent.projectId,
      toolName,
      risk: evaluation.risk,
      decision: evaluation.decision,
      reason: evaluation.reason,
    });

    if (evaluation.decision === "deny") {
      const denied = await this.updateToolCall(toolCall.id, {
        status: "denied",
        error: evaluation.reason,
      });
      await this.events.publish("agent.tool_call.denied", {
        toolCall: denied,
        reason: evaluation.reason,
      });
      return { toolCall: denied };
    }

    if (evaluation.decision === "approval") {
      const approval: ApprovalRecord = {
        id: createId("approval"),
        toolCallId: toolCall.id,
        agentId: agent.id,
        sessionId: agent.sessionId,
        projectId: agent.projectId,
        risk: evaluation.risk,
        reason: evaluation.reason,
        status: "pending",
        requestedAt: new Date().toISOString(),
      };
      await this.upsertApproval(approval);
      const pending = await this.updateToolCall(toolCall.id, {
        status: "pending_approval",
        approvalId: approval.id,
      });
      await this.events.publish("approval.requested", {
        approval,
        toolCall: pending,
      });
      return { toolCall: pending, approval };
    }

    return { toolCall: await this.executeAllowedTool(toolCall.id) };
  }

  async grantApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.getPendingApproval(approvalId);
    const granted: ApprovalRecord = {
      ...approval,
      status: "granted",
      resolvedAt: new Date().toISOString(),
    };
    await this.upsertApproval(granted);
    await this.events.publish("approval.granted", { approval: granted, note });
    const toolCall = this.getToolCall(granted.toolCallId);
    return this.executeAllowedTool(toolCall.id);
  }

  async denyApproval(
    approvalId: string,
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.getPendingApproval(approvalId);
    const deniedApproval: ApprovalRecord = {
      ...approval,
      status: "denied",
      resolvedAt: new Date().toISOString(),
    };
    await this.upsertApproval(deniedApproval);
    const deniedToolCall = await this.updateToolCall(approval.toolCallId, {
      status: "denied",
      error: note ?? "Denied by user.",
    });
    await this.events.publish("approval.denied", {
      approval: deniedApproval,
      note,
    });
    await this.events.publish("agent.tool_call.denied", {
      toolCall: deniedToolCall,
      reason: note ?? "Denied by user.",
    });
    return deniedToolCall;
  }

  getToolCall(toolCallId: string): ToolCallRecord {
    const toolCall = this.toolCalls.get(toolCallId);
    if (!toolCall) throw new Error("Tool call not found.");
    return toolCall;
  }

  private getPendingApproval(approvalId: string): ApprovalRecord {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending")
      throw new Error("Approval is already resolved.");
    return approval;
  }

  private async executeAllowedTool(
    toolCallId: string,
  ): Promise<ToolCallRecord> {
    const toolCall = await this.updateToolCall(toolCallId, {
      status: "running",
    });
    await this.events.publish("agent.tool_call.running", { toolCall });
    try {
      const args = { ...(toolCall.args as Record<string, unknown>) };
      if (toolCall.toolName === "bash") delete args.cwd;
      const result = await executeTool(toolCall.toolName, args, {
        cwd: toolCall.cwd,
      });
      const completed = await this.updateToolCall(toolCall.id, {
        status: "completed",
        result,
        error: undefined,
      });
      await this.events.publish("agent.tool_call.completed", {
        toolCall: completed,
      });
      return completed;
    } catch (error) {
      const failed = await this.updateToolCall(toolCall.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      await this.events.publish("agent.tool_call.error", { toolCall: failed });
      return failed;
    }
  }

  private async updateToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord> {
    const current = this.getToolCall(toolCallId);
    const updated: ToolCallRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.upsertToolCall(updated);
    return updated;
  }

  private async upsertToolCall(toolCall: ToolCallRecord): Promise<void> {
    this.toolCalls.set(toolCall.id, toolCall);
    this.index.upsertToolCall(toolCall);
    await appendJsonLine(this.toolCallsPath(), toolCall, 0o600);
  }

  private async upsertApproval(approval: ApprovalRecord): Promise<void> {
    this.approvals.set(approval.id, approval);
    this.index.upsertApproval(approval);
    await appendJsonLine(this.approvalsPath(), approval, 0o600);
  }

  private async readLatestToolCalls(): Promise<ToolCallRecord[]> {
    const values = await readJsonLines<ToolCallRecord>(
      this.toolCallsPath(),
    ).catch(() => []);
    return latestById(values);
  }

  private async readLatestApprovals(): Promise<ApprovalRecord[]> {
    const values = await readJsonLines<ApprovalRecord>(
      this.approvalsPath(),
    ).catch(() => []);
    return latestById(values);
  }

  private toolCallsPath(): string {
    return join(this.storage.paths.home, "logs", "tool-calls.jsonl");
  }

  private approvalsPath(): string {
    return join(this.storage.paths.home, "approvals", "approvals.jsonl");
  }
}

function latestById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) byId.set(value.id, value);
  return [...byId.values()];
}
