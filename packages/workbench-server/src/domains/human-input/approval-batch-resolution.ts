import { createHash } from "node:crypto";
import type {
  ApprovalRecord,
  ConversationEntry,
  ToolCallRecord,
} from "@nervekit/contracts";
import { HttpError } from "../../http/errors.js";
import type {
  ApprovalInteractionBatch,
  WorkbenchRunService,
} from "../runs/workbench-run.service.js";
import type { ToolService } from "../tools/tool-service.js";
import { toToolCallTranscriptRecord } from "../tools/tool-call-transcript-preview.js";

interface ApprovalBatchResolutionDeps {
  tools: ToolService;
  runs: WorkbenchRunService;
  appendToolResult(
    toolCall: ToolCallRecord,
    isError: boolean,
  ): Promise<ConversationEntry>;
  existingToolResultEntry(
    toolCall: ToolCallRecord,
  ): ConversationEntry | undefined;
}

export class ApprovalBatchResolutionService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly deps: ApprovalBatchResolutionDeps) {}

  async resolve(
    approvalId: string,
    decision: "allow" | "deny",
    note?: string,
  ): Promise<ToolCallRecord> {
    const approval = this.pendingApproval(approvalId);
    const pendingToolCall = this.deps.tools.getToolCall(approval.toolCallId);
    if (!pendingToolCall.runId) {
      await this.deps.tools.decideApproval(approvalId, decision, note);
      return this.deps.tools.finalizeDecidedApproval(approvalId);
    }
    const initialBatch = await this.deps.runs.approvalBatchForToolCall(
      pendingToolCall.id,
      pendingToolCall.runId,
    );
    return this.exclusive(
      `${initialBatch.runId}:${initialBatch.checkpointId}`,
      async () => {
        const currentApproval = this.pendingApproval(approvalId);
        const currentToolCall = this.deps.tools.getToolCall(
          currentApproval.toolCallId,
        );
        const batch = await this.deps.runs.approvalBatchForToolCall(
          currentToolCall.id,
          currentToolCall.runId,
        );
        await this.deps.runs.assertPendingInteractionForToolCall(
          currentToolCall.id,
          currentToolCall.runId,
        );
        await this.deps.tools.decideApproval(approvalId, decision, note);
        if (!this.batchReady(batch)) return currentToolCall;
        return this.drain(batch, currentToolCall.id);
      },
    );
  }

  async recoverReadyBatches(): Promise<void> {
    const recovered = new Set<string>();
    for (const approval of this.deps.tools.listApprovals()) {
      if (approval.status === "pending") continue;
      const toolCall = this.deps.tools.getToolCall(approval.toolCallId);
      if (!toolCall.runId) continue;
      let batch: ApprovalInteractionBatch;
      try {
        batch = await this.deps.runs.approvalBatchForToolCall(
          toolCall.id,
          toolCall.runId,
        );
      } catch {
        continue;
      }
      const key = `${batch.runId}:${batch.checkpointId}`;
      if (recovered.has(key)) continue;
      recovered.add(key);
      if (
        !batch.interactions.some(
          (interaction) => interaction.status === "pending",
        ) ||
        !this.batchReady(batch)
      ) {
        continue;
      }
      await this.exclusive(key, async () => {
        const current = await this.deps.runs.approvalBatchForToolCall(
          toolCall.id,
          toolCall.runId,
        );
        if (
          current.interactions.some(
            (interaction) => interaction.status === "pending",
          ) &&
          this.batchReady(current)
        ) {
          await this.drain(current, toolCall.id);
        }
      });
    }
  }

  private pendingApproval(approvalId: string): ApprovalRecord {
    const approval = this.deps.tools
      .listApprovals()
      .find((candidate) => candidate.id === approvalId);
    if (!approval || approval.status !== "pending") {
      throw new HttpError(
        404,
        "APPROVAL_NOT_FOUND",
        "Approval is not pending.",
      );
    }
    return approval;
  }

  private batchReady(batch: ApprovalInteractionBatch): boolean {
    return batch.batchToolCallIds.every((toolCallId) => {
      const approval = this.approvalForToolCall(toolCallId);
      if (approval) return approval.status !== "pending";
      return isTerminalToolCall(this.deps.tools.getToolCall(toolCallId));
    });
  }

  private async drain(
    batch: ApprovalInteractionBatch,
    targetToolCallId: string,
  ): Promise<ToolCallRecord> {
    const toolCalls: ToolCallRecord[] = [];
    for (const toolCallId of batch.batchToolCallIds) {
      const approval = this.approvalForToolCall(toolCallId);
      const toolCall = approval
        ? await this.deps.tools.finalizeDecidedApproval(approval.id)
        : this.deps.tools.getToolCall(toolCallId);
      if (!isTerminalToolCall(toolCall)) {
        throw new Error(
          `Approval batch member ${toolCall.id} did not reach a terminal state.`,
        );
      }
      toolCalls.push(toolCall);
    }

    const entries: ConversationEntry[] = [];
    for (const toolCall of toolCalls) {
      const existing = this.deps.existingToolResultEntry(toolCall);
      entries.push(
        existing ??
          (await this.deps.appendToolResult(
            toolCall,
            toolCall.status !== "completed",
          )),
      );
    }
    const members = batch.interactions.map((interaction) => {
      const approval = this.approvalForToolCall(interaction.toolCallId);
      if (!approval || approval.status === "pending") {
        throw new Error(
          `Approval decision for ${interaction.toolCallId} is not durable.`,
        );
      }
      return {
        interaction,
        resolution: {
          decision: approval.status === "granted" ? "allow" : "deny",
          note: approval.resolutionNote,
        },
      };
    });
    await this.deps.runs.resolveInteractionBatchForToolCalls({
      members,
      entries,
      toolCalls: toolCalls.map(toToolCallTranscriptRecord),
      resolutionRequestId: resolutionRequestId(batch, (toolCallId) =>
        this.approvalForToolCall(toolCallId),
      ),
    });
    return this.deps.tools.getToolCall(targetToolCallId);
  }

  private approvalForToolCall(toolCallId: string): ApprovalRecord | undefined {
    return this.deps.tools
      .listApprovals()
      .find((approval) => approval.toolCallId === toolCallId);
  }

  private exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(action);
    const tail = task.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    return task.finally(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
  }
}

function resolutionRequestId(
  batch: ApprovalInteractionBatch,
  approvalForToolCall: (toolCallId: string) => ApprovalRecord | undefined,
): string {
  return `resolution_${createHash("sha256")
    .update(
      JSON.stringify({
        runId: batch.runId,
        checkpointId: batch.checkpointId,
        decisions: batch.batchToolCallIds.map((toolCallId) => {
          const approval = approvalForToolCall(toolCallId);
          return approval
            ? [toolCallId, approval.status, approval.resolutionNote]
            : [toolCallId, "policy_terminal"];
        }),
      }),
    )
    .digest("hex")
    .slice(0, 24)}`;
}

function isTerminalToolCall(toolCall: ToolCallRecord): boolean {
  return ["completed", "denied", "error"].includes(toolCall.status);
}
