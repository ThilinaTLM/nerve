import { createHash } from "node:crypto";
import type { ApprovalRecord, ToolCallRecord } from "@nervekit/contracts/tools";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { ApplicationError } from "../../core/application-error.js";
import type {
  ApprovalInteractionBatch,
  WorkbenchRunService,
} from "../runs/application/workbench-run.service.js";
import type { ToolService } from "../tools/execution/tool-service.js";
import { toToolCallTranscriptRecord } from "../tools/artifacts/tool-call-transcript-preview.js";

interface ApprovalBatchResolutionDeps {
  tools: ToolService;
  runs: WorkbenchRunService;
  appendToolResult(
    toolCall: ToolCallRecord,
    isError: boolean,
  ): Promise<ConversationEntry>;
  existingToolResultEntry(
    toolCall: ToolCallRecord,
  ): Promise<ConversationEntry | undefined>;
}

export class ApprovalBatchResolutionService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly deps: ApprovalBatchResolutionDeps) {}

  async resolve(
    approvalId: string,
    decision: "allow" | "deny",
    note?: string,
    resolutionRequestId?: string,
    scope?:
      | "single_call"
      | "same_tool_same_args"
      | "run"
      | "always"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ): Promise<ToolCallRecord> {
    const projected = this.approval(approvalId);
    if (projected.status !== "pending") {
      return this.duplicateResolution(projected, resolutionRequestId, decision);
    }
    const approval = projected;
    const pendingToolCall = this.deps.tools.getToolCall(approval.toolCallId);
    if (!pendingToolCall.runId) {
      await this.deps.tools.decideApproval(
        approvalId,
        decision,
        note,
        resolutionRequestId,
        scope,
      );
      return this.deps.tools.finalizeDecidedApproval(approvalId);
    }
    const initialBatch = await this.deps.runs.approvalBatchForToolCall(
      pendingToolCall.id,
      pendingToolCall.runId,
    );
    return this.exclusive(
      `${initialBatch.runId}:${initialBatch.checkpointId}`,
      async () => {
        const currentApproval = this.approval(approvalId);
        if (currentApproval.status !== "pending") {
          return this.duplicateResolution(
            currentApproval,
            resolutionRequestId,
            decision,
          );
        }
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
        await this.deps.tools.decideApproval(
          approvalId,
          decision,
          note,
          resolutionRequestId,
          scope,
        );
        if (!(await this.batchReady(batch))) {
          return this.deps.tools.getToolCall(currentToolCall.id);
        }
        return this.drain(batch, currentToolCall.id);
      },
    );
  }

  async recoverReadyBatches(): Promise<void> {
    const recovered = new Set<string>();
    for (const approval of this.deps.tools.listApprovals()) {
      const toolCall = await this.deps.tools.getToolCallDetails(
        approval.toolCallId,
      );
      if (!toolCall.runId) continue;
      if (approval.status === "pending") {
        try {
          await this.deps.runs.assertPendingInteractionForToolCall(
            toolCall.id,
            toolCall.runId,
          );
        } catch (error) {
          if (
            error instanceof ApplicationError &&
            error.code === "RUN_INTERACTION_NOT_PENDING"
          ) {
            await this.deps.tools.abandonPendingInteraction(
              toolCall.id,
              "Approval was cancelled because its source run did not suspend.",
            );
            continue;
          }
          throw error;
        }
        continue;
      }
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
        !(await this.batchReady(batch))
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
          (await this.batchReady(current))
        ) {
          await this.drain(current, toolCall.id);
        }
      });
    }
  }

  private approval(approvalId: string): ApprovalRecord {
    const approval = this.deps.tools
      .listApprovals()
      .find((candidate) => candidate.id === approvalId);
    if (!approval) {
      throw new ApplicationError(
        404,
        "APPROVAL_NOT_FOUND",
        "Approval was not found.",
      );
    }
    return approval;
  }

  private async duplicateResolution(
    approval: ApprovalRecord,
    resolutionRequestId: string | undefined,
    decision: "allow" | "deny",
  ): Promise<ToolCallRecord> {
    const toolCall = await this.deps.tools.getToolCallDetails(
      approval.toolCallId,
    );
    const ordinal = Number(approval.id.slice(approval.id.lastIndexOf("_") + 1));
    const interaction = toolCall.interactions[ordinal];
    if (
      resolutionRequestId &&
      interaction?.resolutionRequestId === resolutionRequestId &&
      interaction.resolution?.action === decision
    ) {
      return toolCall;
    }
    throw new ApplicationError(
      409,
      "APPROVAL_ALREADY_RESOLVED",
      "Approval was already resolved by another request.",
    );
  }

  private async batchReady(batch: ApprovalInteractionBatch): Promise<boolean> {
    for (const toolCallId of batch.batchToolCallIds) {
      const approval = this.approvalForToolCall(toolCallId);
      if (approval) {
        if (approval.status === "pending") return false;
        continue;
      }
      const toolCall = await this.deps.tools.getToolCallDetails(toolCallId);
      if (!isTerminalToolCall(toolCall)) return false;
    }
    return true;
  }

  private async drain(
    batch: ApprovalInteractionBatch,
    targetToolCallId: string,
  ): Promise<ToolCallRecord> {
    // Validate the branch before any approved side effect starts. Continuation
    // validation is intentionally not sufficient because it runs after tools.
    await this.deps.runs.assertApprovalBatchContextUnchanged(batch);
    const toolCalls: ToolCallRecord[] = [];
    for (const toolCallId of batch.batchToolCallIds) {
      const approval = this.approvalForToolCall(toolCallId);
      const toolCall = approval
        ? await this.deps.tools.finalizeDecidedApproval(approval.id)
        : await this.deps.tools.getToolCallDetails(toolCallId);
      if (!isTerminalToolCall(toolCall)) {
        throw new Error(
          `Approval batch member ${toolCall.id} did not reach a terminal state.`,
        );
      }
      toolCalls.push(toolCall);
    }

    const entries: ConversationEntry[] = [];
    for (const toolCall of toolCalls) {
      const existing = await this.deps.existingToolResultEntry(toolCall);
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
    return this.deps.tools.getToolCallDetails(targetToolCallId);
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
  return ["completed", "denied", "failed", "cancelled"].includes(
    toolCall.status,
  );
}
