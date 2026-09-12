import { createHash } from "node:crypto";
import type { ApprovalRecord, ToolCallRecord } from "@nervekit/contracts/tools";
import type { LifecycleWork } from "@nervekit/contracts/runs";
import type {
  ConversationEntry,
  ConversationJournalEvent,
} from "@nervekit/contracts/conversations";
import { ApplicationError } from "../../core/application-error.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/logging.js";
import type {
  ApprovalInteractionBatch,
  WorkbenchRunService,
} from "../runs/application/workbench-run.service.js";
import type { ToolService } from "../tools/execution/tool-service.js";
import { toToolCallTranscriptRecord } from "../tools/artifacts/tool-call-transcript-preview.js";
import type { RunLifecycleService } from "../runs/application/run-lifecycle.service.js";

interface ApprovalBatchResolutionDeps {
  tools: ToolService;
  runs: WorkbenchRunService;
  logger?: ApplicationLogger;
  lifecycle?: RunLifecycleService;
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
      await this.decideApprovalDurably(
        approval,
        pendingToolCall,
        decision,
        note,
        resolutionRequestId,
        scope,
        undefined,
        true,
      );
      return this.deps.lifecycle
        ? this.deps.tools.getToolCallDetails(pendingToolCall.id)
        : this.deps.tools.finalizeDecidedApproval(approvalId);
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
        if (this.deps.lifecycle) {
          await this.deps.runs.assertApprovalBatchContextUnchanged(batch);
        }
        const releaseBatch = await this.batchReadyAfterDecision(
          batch,
          currentToolCall.id,
        );
        await this.decideApprovalDurably(
          currentApproval,
          currentToolCall,
          decision,
          note,
          resolutionRequestId,
          scope,
          batch,
          releaseBatch,
        );
        if (this.deps.lifecycle || !(await this.batchReady(batch))) {
          return this.deps.tools.getToolCall(currentToolCall.id);
        }
        return this.drain(batch, currentToolCall.id);
      },
    );
  }

  private async decideApprovalDurably(
    approval: ApprovalRecord,
    toolCall: ToolCallRecord,
    decision: "allow" | "deny",
    note: string | undefined,
    resolutionRequestId: string | undefined,
    scope: Parameters<ToolService["decideApproval"]>[4],
    batch: ApprovalInteractionBatch | undefined,
    releaseBatch: boolean,
  ): Promise<void> {
    const lifecycle = this.deps.lifecycle;
    if (!lifecycle) {
      await this.deps.tools.decideApproval(
        approval.id,
        decision,
        note,
        resolutionRequestId,
        scope,
      );
      return;
    }
    const requestId =
      resolutionRequestId ?? `approval:${approval.id}:${decision}`;
    const inputHash = `sha256:${createHash("sha256")
      .update(
        JSON.stringify({ approvalId: approval.id, decision, note, scope }),
      )
      .digest("hex")}`;
    await this.deps.tools.decideApproval(
      approval.id,
      decision,
      note,
      resolutionRequestId,
      scope,
      async (_next, events: ConversationJournalEvent[]) => {
        const timestamp = new Date().toISOString();
        const work = await this.approvalDecisionWork({
          approval,
          toolCall,
          decision,
          batch,
          releaseBatch,
          requestId,
          inputHash,
          timestamp,
        });
        await lifecycle.commit({
          conversationId: toolCall.conversationId,
          requestId,
          inputHash,
          kind: "run.approval_decided",
          events,
          work,
          outcome: { approvalId: approval.id, decision },
        });
      },
    );
  }

  private async batchReadyAfterDecision(
    batch: ApprovalInteractionBatch,
    targetToolCallId: string,
  ): Promise<boolean> {
    for (const toolCallId of batch.batchToolCallIds) {
      if (toolCallId === targetToolCallId) continue;
      const approval =
        await this.deps.tools.getApprovalForToolCallDetails(toolCallId);
      if (approval) {
        if (approval.status === "pending") return false;
        continue;
      }
      if (
        !isTerminalToolCall(
          await this.deps.tools.getToolCallDetails(toolCallId),
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private async approvalDecisionWork(input: {
    approval: ApprovalRecord;
    toolCall: ToolCallRecord;
    decision: "allow" | "deny";
    batch?: ApprovalInteractionBatch;
    releaseBatch: boolean;
    requestId: string;
    inputHash: string;
    timestamp: string;
  }): Promise<LifecycleWork[]> {
    const members: Array<{ toolCallId: string; execute: boolean }> = [];
    if (!input.batch) {
      members.push({
        toolCallId: input.toolCall.id,
        execute: input.decision === "allow",
      });
    } else if (input.releaseBatch) {
      for (const toolCallId of input.batch.batchToolCallIds) {
        const approval =
          await this.deps.tools.getApprovalForToolCallDetails(toolCallId);
        members.push({
          toolCallId,
          execute:
            toolCallId === input.toolCall.id
              ? input.decision === "allow"
              : approval?.status === "granted",
        });
      }
    }
    const executable = members.filter((member) => member.execute);
    const selected =
      executable.length > 0
        ? executable
        : [
            {
              toolCallId: input.toolCall.id,
              execute: false,
            },
          ];
    return selected.map((member) => {
      const logical = `${member.toolCallId}:${input.requestId}`;
      const workHash = createHash("sha256").update(logical).digest("hex");
      return {
        id: `work_${workHash.slice(0, 24)}`,
        deduplicationKey: `approval:${logical}`,
        conversationId: input.toolCall.conversationId,
        ...(input.toolCall.runId ? { runId: input.toolCall.runId } : {}),
        proposalId: member.toolCallId,
        kind: member.execute ? "execute_tool" : "reconcile_conversation",
        state: "ready",
        inputHash: input.inputHash,
        generation: 0,
        attemptCount: 0,
        notBefore: input.timestamp,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      } satisfies LifecycleWork;
    });
  }

  async recoverReadyBatches(conversationId?: string): Promise<number> {
    let repaired = 0;
    const pendingApprovalHistory =
      this.deps.tools.listApprovalHistoryIncludingNonActionable?.("pending") ??
      this.deps.tools.listApprovals("pending");
    for (const approval of pendingApprovalHistory) {
      if (conversationId && approval.conversationId !== conversationId)
        continue;
      const toolCall = await this.deps.tools.getToolCallDetails(
        approval.toolCallId,
      );
      if (!toolCall.runId) continue;
      try {
        await this.deps.runs.assertPendingInteractionForToolCall(
          toolCall.id,
          toolCall.runId,
        );
        const batch = await this.deps.runs.approvalBatchForToolCall(
          toolCall.id,
          toolCall.runId,
        );
        await this.deps.runs.assertApprovalBatchContextUnchanged(batch);
      } catch (error) {
        if (isStaleApprovalContextError(error)) {
          const batch = await this.deps.runs.approvalBatchForToolCall(
            toolCall.id,
            toolCall.runId,
          );
          await this.deps.runs.cancelStaleApprovalBatch(
            batch,
            `saved approval context became stale (${error.code})`,
          );
          repaired += 1;
          continue;
        }
        if (
          error instanceof ApplicationError &&
          error.code === "RUN_INTERACTION_NOT_PENDING"
        ) {
          await this.deps.tools.abandonPendingInteraction(
            toolCall.id,
            "Approval was cancelled because its source run did not suspend.",
          );
          repaired += 1;
          continue;
        }
        throw error;
      }
    }

    const recovered = new Set<string>();
    const pendingInteractions =
      await this.deps.runs.listPendingApprovalInteractions(conversationId);
    for (const interaction of pendingInteractions) {
      const approval = await this.deps.tools.getApprovalForToolCallDetails(
        interaction.toolCallId,
      );
      if (!approval || approval.status === "pending") continue;
      let batch: ApprovalInteractionBatch;
      try {
        batch = await this.deps.runs.recoverableApprovalBatchForToolCall(
          interaction.toolCallId,
          interaction.runId,
        );
      } catch {
        continue;
      }
      const key = `${batch.runId}:${batch.checkpointId}`;
      if (recovered.has(key)) continue;
      recovered.add(key);
      if (!(await this.batchReady(batch))) continue;
      await this.exclusive(key, async () => {
        let current: ApprovalInteractionBatch;
        try {
          current = await this.deps.runs.recoverableApprovalBatchForToolCall(
            interaction.toolCallId,
            interaction.runId,
          );
        } catch {
          return;
        }
        if (
          current.interactions.some(
            (candidate) => candidate.status === "pending",
          ) &&
          (await this.batchReady(current))
        ) {
          await this.recoverValidatedBatch(current, interaction.toolCallId);
          repaired += 1;
        }
      });
    }
    return repaired;
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
      const approval =
        await this.deps.tools.getApprovalForToolCallDetails(toolCallId);
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
    return this.drainValidated(batch, targetToolCallId);
  }

  private async recoverValidatedBatch(
    batch: ApprovalInteractionBatch,
    targetToolCallId: string,
  ): Promise<ToolCallRecord> {
    try {
      await this.deps.runs.assertApprovalBatchRecoveryContextUnchanged(batch);
    } catch (error) {
      if (!isStaleApprovalContextError(error)) throw error;
      const result = await this.deps.runs.cancelStaleApprovalBatch(
        batch,
        `saved approval context became stale (${error.code})`,
      );
      if (result.outcome === "cancelled") {
        await this.deps.logger?.warn(
          "Saved approval recovery was cancelled because its context changed; no tools were executed by this recovery attempt. Review the conversation before starting a new turn",
          {
            conversationId: result.run.conversationId,
            agentId: result.run.agentId,
            runId: batch.runId,
            context: {
              errorCode: error.code,
              checkpointId: batch.checkpointId,
              toolCallIds: batch.batchToolCallIds,
              outcome: result.outcome,
            },
          },
        );
      }
      return this.deps.tools.getToolCallDetails(targetToolCallId);
    }
    if (!(await this.batchTerminal(batch))) {
      return this.deps.tools.getToolCallDetails(targetToolCallId);
    }
    return this.drainValidated(batch, targetToolCallId);
  }

  private async batchTerminal(
    batch: ApprovalInteractionBatch,
  ): Promise<boolean> {
    for (const toolCallId of batch.batchToolCallIds) {
      if (
        !isTerminalToolCall(
          await this.deps.tools.getToolCallDetails(toolCallId),
        )
      ) {
        return false;
      }
    }
    return true;
  }

  private async drainValidated(
    batch: ApprovalInteractionBatch,
    targetToolCallId: string,
  ): Promise<ToolCallRecord> {
    const toolCalls: ToolCallRecord[] = [];
    const approvalsByToolCallId = new Map<string, ApprovalRecord>();
    for (const toolCallId of batch.batchToolCallIds) {
      const approval =
        await this.deps.tools.getApprovalForToolCallDetails(toolCallId);
      if (approval) approvalsByToolCallId.set(toolCallId, approval);
      const current = await this.deps.tools.getToolCallDetails(toolCallId);
      const toolCall = isTerminalToolCall(current)
        ? current
        : approval
          ? await this.deps.tools.finalizeDecidedApproval(approval.id)
          : current;
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
      const approval = approvalsByToolCallId.get(interaction.toolCallId);
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
        approvalsByToolCallId.get(toolCallId),
      ),
    });
    return this.deps.tools.getToolCallDetails(targetToolCallId);
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

function isStaleApprovalContextError(
  error: unknown,
): error is ApplicationError {
  return (
    error instanceof ApplicationError &&
    (error.code === "RUN_CHECKPOINT_STALE" ||
      error.code === "RUN_TOOL_REVISION_STALE")
  );
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
