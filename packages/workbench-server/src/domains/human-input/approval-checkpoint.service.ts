import { createHash } from "node:crypto";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import type {
  ApprovalCheckpointAcknowledgement,
  ApprovalCheckpointPhase,
  LifecycleWork,
  RecoveryIssue,
  RunInteractionRecord,
} from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { isTerminalToolStatus } from "@nervekit/contracts/events";
import { ApplicationError } from "../../core/application-error.js";
import { ConversationBranchConflictError } from "../conversations/conversation-journal.repository.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/logging.js";
import type { RunLifecycleService } from "../runs/application/run-lifecycle.service.js";
import type { WorkbenchRunService } from "../runs/application/workbench-run.service.js";
import {
  approvalCheckpointMembers,
  KeyedSerialLock,
  type RunHydratedState,
} from "../runs/runtime/index.js";
import type { LifecycleWorkExecutionResult } from "../runs/runtime/lifecycle-work-executor.js";
import type { ToolService } from "../tools/execution/tool-service.js";
import {
  PreDispatchError,
  ToolExecutionAlreadyClaimedError,
} from "../tools/execution/tool-execution-claim.js";
import { toToolCallTranscriptRecord } from "../tools/artifacts/tool-call-transcript-preview.js";

export type ApprovalScope = Parameters<
  ToolService["projectApprovalDecision"]
>[0]["scope"];

export interface ApprovalDecisionRequest {
  toolCallId: string;
  ordinal: number;
  expectedRevision?: number;
  decision: "allow" | "deny";
  note?: string;
  scope?: ApprovalScope;
  resolutionRequestId: string;
}

export interface ApprovalDecisionReceipt {
  toolCall: ToolCallRecord;
  checkpoint?: ApprovalCheckpointAcknowledgement;
}

export interface ApprovalCheckpointWorkStore {
  listLifecycleWorkForRun(runId: string): Promise<LifecycleWork[]>;
  listRecoveryIssues(conversationId: string): Promise<RecoveryIssue[]>;
  persistRecoveryIssue(issue: RecoveryIssue): Promise<void>;
}

export interface ApprovalCheckpointDeps {
  tools: ToolService;
  runs: WorkbenchRunService;
  lifecycle: RunLifecycleService;
  work: ApprovalCheckpointWorkStore;
  /** Non-blocking dispatcher hint; committed work is also found by polling. */
  notifyWork(): void;
  appendToolResult(
    toolCall: ToolCallRecord,
    isError: boolean,
    expectedActiveBranchParentEntryId?: string | null,
  ): Promise<ConversationEntry>;
  existingToolResultEntry(
    toolCall: ToolCallRecord,
  ): Promise<ConversationEntry | undefined>;
  logger?: ApplicationLogger;
  now?: () => Date;
}

const UNKNOWN_OUTCOME_MESSAGE =
  "The outcome of this tool is unknown: it may or may not have run. Nerve did not run it again.";

/**
 * The single authority for run-scoped and standalone tool approvals.
 *
 * - `decide` records one decision in a short durable transaction and returns.
 *   The final decision of a checkpoint releases deterministic execute_tool work
 *   in that same transaction. It never waits for execution.
 * - `executeWork` is the execute_tool handler. It reads every precondition
 *   inside the tool execution claim and runs the tool outside all locks.
 * - `reconcileCheckpoint` settles a released checkpoint once all member
 *   results are durable, exactly once.
 */
export class ApprovalCheckpointService {
  private readonly settlement = new KeyedSerialLock();

  constructor(private readonly deps: ApprovalCheckpointDeps) {}

  async decide(
    request: ApprovalDecisionRequest,
  ): Promise<ApprovalDecisionReceipt> {
    const target = this.deps.tools.getToolCall(request.toolCallId);
    const runId = target.runId;
    const { toolCall, replayed } =
      await this.deps.tools.projectApprovalDecision(
        {
          toolCallId: request.toolCallId,
          ordinal: request.ordinal,
          expectedRevision: request.expectedRevision,
          decision: request.decision,
          note: request.note,
          scope: request.scope,
          resolutionRequestId: request.resolutionRequestId,
        },
        async (next, events) => {
          if (runId) {
            const outcome = await this.deps.runs.recordApprovalDecision(runId, {
              toolCallId: next.id,
              resolutionRequestId: request.resolutionRequestId,
              resolution: { decision: request.decision, note: request.note },
              toolProjection: next,
              releaseWork: true,
            });
            if (outcome.replayed) {
              throw new ApplicationError(
                409,
                "APPROVAL_STATE_CONFLICT",
                "The run already recorded this approval, but the tool record did not.",
              );
            }
            return;
          }
          const inputHash = sha256({
            toolCallId: next.id,
            ordinal: request.ordinal,
            decision: request.decision,
            note: request.note,
            scope: request.scope,
          });
          await this.deps.lifecycle.commit({
            conversationId: next.conversationId,
            requestId: `approval:${next.id}:${request.ordinal}:${request.resolutionRequestId}`,
            inputHash,
            kind: "tool.approval_decided",
            events,
            work:
              request.decision === "allow"
                ? [standaloneExecutionWork(next, inputHash, this.now())]
                : [],
            outcome: { toolCallId: next.id, decision: request.decision },
          });
        },
      );
    if (!replayed) this.deps.notifyWork();
    return {
      toolCall,
      ...(runId ? { checkpoint: await this.acknowledgement(runId) } : {}),
    };
  }

  /** The execute_tool lifecycle handler. */
  async executeWork(
    work: LifecycleWork,
  ): Promise<LifecycleWorkExecutionResult> {
    const toolCallId = work.proposalId;
    if (!toolCallId) {
      return {
        state: "failed",
        failurePhase: "pre_dispatch",
        lastError: "Tool work has no proposal.",
      };
    }
    let claimed: ToolCallRecord;
    try {
      claimed = await this.deps.tools.claimApprovedExecution(
        toolCallId,
        work.runId
          ? (current) => this.assertReleasedMember(work.runId!, current)
          : undefined,
      );
    } catch (error) {
      return this.claimFailure(work, toolCallId, error);
    }
    const completed = await this.deps.tools.executeClaimed(claimed);
    await this.afterMemberSettled(work.runId);
    if (completed.errorDetails?.code === "TOOL_OUTCOME_UNKNOWN") {
      return {
        state: "outcome_unknown",
        failurePhase: "post_dispatch",
        lastError: completed.error ?? UNKNOWN_OUTCOME_MESSAGE,
      };
    }
    return {
      state: completed.status === "cancelled" ? "cancelled" : "succeeded",
      ...(claimed.execution
        ? { externalLocator: claimed.execution.executionId }
        : {}),
    };
  }

  /**
   * Settles a released checkpoint whose members all have terminal results:
   * appends any missing result entries in member order, then moves the run to
   * continuation in one transition. Safe to call repeatedly and concurrently.
   */
  async reconcileCheckpoint(runId: string): Promise<ApprovalCheckpointPhase> {
    return this.settlement.exclusive(runId, async () => {
      const state = await this.deps.runs.loadRunState(runId);
      if (!state) return "cancelled";
      if (state.run.status !== "executing_tools") return this.phase(state);
      // Branch movement can happen after the last claim; fence unclaimed
      // siblings immediately, without terminating an executing sibling.
      if (await this.releasedCheckpointIsStale(state)) {
        await this.cancelUnclaimedStaleMembers(state);
        const phase = await this.phase(state);
        if (phase === "settled") {
          await this.deps.runs.cancelStaleApprovalCheckpoint(
            state,
            "The approval checkpoint's conversation branch changed before its tools settled.",
          );
          return "cancelled";
        }
        return phase;
      }
      const phase = await this.phase(state);
      if (phase !== "settled") return phase;
      const toolCalls = await this.memberToolCalls(state);
      const entries: ConversationEntry[] = [];
      let expectedParent = state.checkpoints
        .find(
          (checkpoint) =>
            checkpoint.checkpointId === state.run.lastCheckpointId,
        )
        ?.entryIds.at(-1);
      if (!expectedParent) {
        throw new ApplicationError(
          409,
          "RUN_CHECKPOINT_STALE",
          "The approval checkpoint has no durable branch tip.",
        );
      }
      for (const toolCall of toolCalls) {
        const current = await this.deps.runs.loadRunState(runId);
        if (
          current?.run.status !== "executing_tools" ||
          current.run.lastCheckpointId !== state.run.lastCheckpointId
        ) {
          return "cancelled";
        }
        if (await this.releasedCheckpointIsStale(current)) {
          await this.deps.runs.cancelStaleApprovalCheckpoint(
            state,
            "The approval checkpoint's conversation branch changed before its results were appended.",
          );
          return "cancelled";
        }
        try {
          const entry: ConversationEntry =
            (await this.deps.existingToolResultEntry(toolCall)) ??
            (await this.deps.appendToolResult(
              toolCall,
              toolCall.status !== "completed",
              expectedParent,
            ));
          if (entry.parentEntryId !== expectedParent) {
            throw new ConversationBranchConflictError(toolCall.conversationId);
          }
          entries.push(entry);
          expectedParent = entry.id;
        } catch (error) {
          if (!isStaleCheckpoint(error)) throw error;
          await this.deps.runs.cancelStaleApprovalCheckpoint(
            state,
            "The approval checkpoint's conversation branch changed while its results were appended.",
          );
          return "cancelled";
        }
      }
      try {
        await this.deps.runs.settleApprovalCheckpoint(
          runId,
          state.run.lastCheckpointId!,
          {
            entries,
            toolCalls: toolCalls.map(toToolCallTranscriptRecord),
          },
        );
      } catch (error) {
        if (!isStaleCheckpoint(error)) throw error;
        // The branch moved while results were being assembled. Never queue a
        // model continuation against the obsolete checkpoint.
        await this.deps.runs.cancelStaleApprovalCheckpoint(
          state,
          "The approval checkpoint's conversation branch changed before continuation.",
        );
        return "cancelled";
      }
      return "settled";
    });
  }

  /**
   * Reconciles every approval checkpoint in scope from durable records:
   * cancels stale waiting checkpoints and settles fully executed ones.
   */
  async reconcileAll(conversationId?: string): Promise<number> {
    let repaired = 0;
    for (const state of await this.deps.runs.listApprovalCheckpointRuns(
      conversationId,
    )) {
      if (state.run.status === "waiting") {
        try {
          await this.deps.runs.assertCheckpointOnActiveBranch(
            state,
            state.run.lastCheckpointId,
          );
        } catch (error) {
          if (!isStaleCheckpoint(error)) throw error;
          await this.deps.runs.cancelStaleApprovalCheckpoint(
            state,
            "saved approval context became stale (RUN_CHECKPOINT_STALE)",
          );
          repaired += 1;
        }
        continue;
      }
      if (state.run.status === "executing_tools") {
        const phase = await this.reconcileCheckpoint(state.run.runId);
        if (phase === "settled" || phase === "cancelled") repaired += 1;
      }
    }
    return repaired;
  }

  /**
   * Explicit recovery decision for a blocked checkpoint: members whose work
   * ended without a proven result are settled as failed with an explicit
   * message (never executed again), then the checkpoint settles.
   */
  async resolveBlockedCheckpoint(runId: string): Promise<void> {
    const state = await this.deps.runs.loadRunState(runId);
    if (!state || state.run.status !== "executing_tools") return;
    if ((await this.phase(state)) !== "blocked") {
      throw new ApplicationError(
        409,
        "RUN_EXECUTING_TOOLS",
        "Approved tools are still executing.",
      );
    }
    const work = await this.deps.work.listLifecycleWorkForRun(runId);
    for (const toolCall of await this.memberToolCalls(state)) {
      if (isTerminalToolStatus(toolCall.status)) continue;
      if (hasActiveWork(work, toolCall.id)) continue;
      if (toolCall.status === "committed") {
        await this.deps.tools.settleBeforeDispatch(
          toolCall.id,
          "failed",
          "The approved tool was not executed. Nerve did not run it.",
        );
      } else {
        await this.deps.tools.settleUnknownOutcome(
          toolCall.id,
          UNKNOWN_OUTCOME_MESSAGE,
        );
      }
    }
    const outcome = await this.reconcileCheckpoint(runId);
    if (outcome !== "settled" && outcome !== "cancelled") {
      throw new ApplicationError(
        409,
        "RUN_CHECKPOINT_UNSETTLED",
        "The approval checkpoint could not be settled.",
      );
    }
  }

  /**
   * One-time, idempotent conversion of checkpoints decided by the previous
   * implementation (decisions stored only on tool records). It records those
   * decisions on the run without creating or requeuing any work. Allowed,
   * unfinished members without active work are reported for operator review.
   */
  async backfillLegacyCheckpoints(): Promise<number> {
    let converted = 0;
    for (const state of await this.deps.runs.listApprovalCheckpointRuns()) {
      if (state.run.status !== "waiting") continue;
      const checkpointId = state.run.lastCheckpointId;
      const pending = approvalCheckpointMembers(
        state,
        checkpointId ?? "",
      ).filter(
        (member) => member.kind === "approval" && member.status === "pending",
      );
      let latest = state;
      for (const member of pending) {
        const toolCall = await this.deps.tools.getToolCallDetails(
          member.toolCallId,
        );
        const decided = toolCall.interactions[member.interactionOrdinal];
        if (
          decided?.kind !== "approval" ||
          decided.status !== "resolved" ||
          !decided.resolution
        ) {
          continue;
        }
        try {
          const outcome = await this.deps.runs.recordApprovalDecision(
            state.run.runId,
            {
              toolCallId: member.toolCallId,
              resolutionRequestId:
                decided.resolutionRequestId ?? `legacy:${member.id}`,
              resolution: {
                decision: decided.resolution.action,
                note: decided.resolution.note,
              },
              releaseWork: false,
            },
          );
          converted += 1;
          if (outcome.run.status !== "waiting") {
            latest = (await this.deps.runs.loadRunState(state.run.runId))!;
          }
        } catch (error) {
          if (!isStaleCheckpoint(error)) throw error;
          await this.deps.runs.cancelStaleApprovalCheckpoint(
            state,
            "saved approval context became stale (RUN_CHECKPOINT_STALE)",
          );
          break;
        }
      }
      if (latest.run.status === "executing_tools") {
        await this.reportUnownedMembers(latest);
      }
    }
    return converted;
  }

  private async reportUnownedMembers(state: RunHydratedState): Promise<void> {
    const work = await this.deps.work.listLifecycleWorkForRun(state.run.runId);
    const issues = await this.deps.work.listRecoveryIssues(
      state.run.conversationId,
    );
    for (const toolCall of await this.memberToolCalls(state)) {
      if (
        isTerminalToolStatus(toolCall.status) ||
        hasActiveWork(work, toolCall.id) ||
        issues.some((issue) => issue.proposalId === toolCall.id)
      ) {
        continue;
      }
      const running = toolCall.status === "running";
      await this.deps.work.persistRecoveryIssue({
        id: `recovery_${sha256({ legacy: toolCall.id }).slice(7, 31)}`,
        conversationId: state.run.conversationId,
        runId: state.run.runId,
        proposalId: toolCall.id,
        code: running ? "outcome_unknown" : "conflicting_state",
        message: running
          ? "A tool approved before this upgrade may have run, but no result was recorded. Nerve did not run it again."
          : "A tool approved before this upgrade has no execution work. Nerve did not run it; review it before continuing.",
        actions: ["inspect", "cancel_run", "authorize_retry"],
        createdAt: this.now(),
      });
    }
  }

  private async releasedCheckpointIsStale(
    state: RunHydratedState,
  ): Promise<boolean> {
    try {
      await this.deps.runs.assertCheckpointOnActiveBranch(
        state,
        state.run.lastCheckpointId,
      );
      return false;
    } catch (error) {
      if (!isStaleCheckpoint(error)) throw error;
      return true;
    }
  }

  /**
   * A stale branch fences only members that have not crossed the durable
   * execution boundary. Claimed siblings keep their actual outcomes; their
   * terminal records are reconciled before the obsolete run is cancelled.
   */
  private async cancelUnclaimedStaleMembers(
    state: RunHydratedState,
  ): Promise<void> {
    for (const toolCall of await this.memberToolCalls(state)) {
      if (toolCall.status !== "committed") continue;
      await this.deps.tools.settleBeforeDispatch(
        toolCall.id,
        "cancelled",
        "The approval checkpoint's conversation branch changed. This tool was not executed.",
      );
    }
  }

  /** Derived checkpoint phase; never stored. */
  private async phase(
    state: RunHydratedState,
  ): Promise<ApprovalCheckpointPhase> {
    if (state.run.status === "waiting") return "awaiting_decisions";
    if (
      ["cancelled", "failed", "cancellation_requested"].includes(
        state.run.status,
      )
    ) {
      return "cancelled";
    }
    if (state.run.status !== "executing_tools") return "settled";
    const toolCalls = await this.memberToolCalls(state);
    const unsettled = toolCalls.filter(
      (toolCall) => !isTerminalToolStatus(toolCall.status),
    );
    if (unsettled.length === 0) return "settled";
    const work = await this.deps.work.listLifecycleWorkForRun(state.run.runId);
    return unsettled.every((toolCall) => hasActiveWork(work, toolCall.id))
      ? "executing"
      : "blocked";
  }

  private async memberToolCalls(
    state: RunHydratedState,
  ): Promise<ToolCallRecord[]> {
    const members = approvalCheckpointMembers(
      state,
      state.run.lastCheckpointId ?? "",
    );
    const ids =
      members[0]?.batchToolCallIds ??
      members.map((member) => member.toolCallId);
    return Promise.all(ids.map((id) => this.deps.tools.getToolCallDetails(id)));
  }

  /** Runs inside the tool execution claim; reads authoritative run state. */
  private async assertReleasedMember(
    runId: string,
    current: ToolCallRecord,
  ): Promise<void> {
    const state = await this.deps.runs.loadRunState(runId);
    if (!state || state.run.status !== "executing_tools") {
      throw new PreDispatchError(
        "stale_context",
        "The approval checkpoint is no longer executing. No tool was executed.",
      );
    }
    const interaction = state.interactions.find(
      (item: RunInteractionRecord) =>
        item.toolCallId === current.id &&
        item.kind === "approval" &&
        item.checkpointId === state.run.lastCheckpointId,
    );
    if (
      interaction?.status !== "resolved" ||
      interaction.resolution?.decision !== "allow"
    ) {
      throw new PreDispatchError(
        "not_approved",
        "The run has no durable approval for this tool. No tool was executed.",
      );
    }
    try {
      await this.deps.runs.assertCheckpointOnActiveBranch(
        state,
        state.run.lastCheckpointId,
      );
    } catch (error) {
      if (!isStaleCheckpoint(error)) throw error;
      throw new PreDispatchError("stale_context", error.message);
    }
  }

  private async claimFailure(
    work: LifecycleWork,
    toolCallId: string,
    error: unknown,
  ): Promise<LifecycleWorkExecutionResult> {
    if (error instanceof ToolExecutionAlreadyClaimedError) {
      if (isTerminalToolStatus(error.toolCall.status)) {
        await this.afterMemberSettled(work.runId);
        if (error.toolCall.errorDetails?.code === "TOOL_OUTCOME_UNKNOWN") {
          return {
            state: "outcome_unknown",
            failurePhase: "post_dispatch",
            lastError: error.toolCall.error ?? UNKNOWN_OUTCOME_MESSAGE,
          };
        }
        if (error.toolCall.status === "cancelled") {
          return {
            state: "cancelled",
            failurePhase: "pre_dispatch",
            lastError: error.toolCall.error,
          };
        }
        return { state: "succeeded" };
      }
      // An earlier attempt crossed the dispatch boundary without a result.
      return {
        state: "outcome_unknown",
        failurePhase: "post_dispatch",
        lastError: UNKNOWN_OUTCOME_MESSAGE,
      };
    }
    if (error instanceof PreDispatchError) {
      if (error.reason === "stale_context") {
        await this.deps.tools.settleBeforeDispatch(
          toolCallId,
          "cancelled",
          error.message,
        );
        await this.afterMemberSettled(work.runId);
        return {
          state: "cancelled",
          failurePhase: "pre_dispatch",
          lastError: error.message,
        };
      }
      await this.deps.tools.settleBeforeDispatch(
        toolCallId,
        "failed",
        error.message,
      );
      await this.afterMemberSettled(work.runId);
      return {
        state: "failed",
        failurePhase: "pre_dispatch",
        lastError: error.message,
      };
    }
    const current = await this.deps.tools.getToolCallDetails(toolCallId);
    if (current.status === "committed") {
      // The claim was never committed, so nothing was dispatched. The
      // checkpoint is blocked until an explicit recovery decision.
      return {
        state: "failed",
        failurePhase: "pre_dispatch",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }

  private async afterMemberSettled(runId: string | undefined): Promise<void> {
    if (!runId) return;
    try {
      await this.reconcileCheckpoint(runId);
    } catch (error) {
      // Reconciliation polling and startup recovery retry this transition.
      await this.deps.logger
        ?.warn("Approval checkpoint reconciliation deferred", {
          runId,
          error,
        })
        .catch(() => undefined);
    }
  }

  private async acknowledgement(
    runId: string,
  ): Promise<ApprovalCheckpointAcknowledgement | undefined> {
    const state = await this.deps.runs.loadRunState(runId);
    if (!state?.run.lastCheckpointId) return undefined;
    return {
      runId,
      checkpointId: state.run.lastCheckpointId,
      runRevision: state.run.revision,
      phase: await this.phase(state),
    };
  }

  private now(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

function hasActiveWork(
  work: readonly LifecycleWork[],
  toolCallId: string,
): boolean {
  return work.some(
    (item) =>
      item.kind === "execute_tool" &&
      item.proposalId === toolCallId &&
      (item.state === "ready" || item.state === "leased"),
  );
}

function standaloneExecutionWork(
  toolCall: ToolCallRecord,
  inputHash: string,
  now: string,
): LifecycleWork {
  const identity = sha256({ kind: "execute_tool", toolCallId: toolCall.id });
  return {
    id: `work_${identity.slice("sha256:".length, "sha256:".length + 24)}`,
    deduplicationKey: `approval-exec:${toolCall.id}`,
    conversationId: toolCall.conversationId,
    proposalId: toolCall.id,
    kind: "execute_tool",
    state: "ready",
    inputHash,
    generation: 0,
    attemptCount: 0,
    notBefore: now,
    createdAt: now,
    updatedAt: now,
  };
}

function isStaleCheckpoint(
  error: unknown,
): error is ApplicationError | ConversationBranchConflictError {
  return (
    error instanceof ConversationBranchConflictError ||
    (error instanceof ApplicationError &&
      (error.code === "RUN_CHECKPOINT_STALE" ||
        error.code === "RUN_TOOL_REVISION_STALE"))
  );
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
