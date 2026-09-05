import type {
  ApprovalSettlement,
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import { INTERRUPTED_TOOL_ERROR_CODE } from "@nervekit/contracts/events";
import type { ToolService } from "../tools/execution/tool-service.js";
import type { WorkbenchRunService } from "../runs/application/workbench-run.service.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/logging.js";
import { ConversationJournalRevisionConflictError } from "../conversations/conversation-journal.repository.js";
import type { ApprovalSettlementRepository } from "./approval-settlement.repository.js";

interface SettlementDeps {
  repository: ApprovalSettlementRepository;
  tools: ToolService;
  runs: WorkbenchRunService;
  logger: ApplicationLogger;
  reconcileConversationProjection(
    conversation: ConversationRecord,
    entries: readonly ConversationEntry[],
  ): void;
}
const terminal = new Set(["completed", "denied", "failed", "cancelled"]);
const stopped = new Set([
  "awaiting_decisions",
  "blocked",
  "completed",
  "cancelled",
]);

/** Daemon-owned progress. Timers are only wake-ups; the journal owns all work. */
export class ApprovalSettlementService {
  private enabled = false;
  private readonly active = new Map<string, Promise<void>>();
  private readonly due = new Map<string, ApprovalSettlement>();
  private readonly rewokenWhileActive = new Map<string, ApprovalSettlement>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: SettlementDeps) {}

  async start(): Promise<void> {
    if (this.enabled) return;
    this.unsubscribe ??= this.deps.repository.journal.onCommit((commit) => {
      for (const event of commit.events) {
        if (event.kind === "approval_settlement.upserted")
          this.wake(event.settlement);
        if (event.kind === "run.transition_committed") {
          const state = this.deps.repository.journal.state(
            commit.conversationId,
          );
          for (const value of state?.approvalSettlements.values() ?? []) {
            if (
              value.runId === event.transition.runId &&
              (value.phase === "awaiting_decisions" ||
                [
                  "cancelled",
                  "failed",
                  "completed",
                  "cancellation_requested",
                ].includes(event.transition.run.status))
            ) {
              this.wake(value, true);
            }
          }
        }
      }
    });
    // Normalize only proven approval obligations, never arbitrary suspended runs.
    for (const interaction of await this.deps.runs.listApprovalRecoveryInteractions()) {
      try {
        const tool = await this.deps.tools.getToolCallDetails(
          interaction.toolCallId,
        );
        if (
          tool.interactions[interaction.interactionOrdinal]?.status !==
          "resolved"
        )
          continue;
        this.wake(
          await this.deps.repository.normalize(tool.conversationId, tool),
          true,
        );
      } catch (error) {
        await this.log(error, {
          conversationId: interaction.conversationId,
          runId: interaction.runId,
          toolCallId: interaction.toolCallId,
        });
      }
    }
    for (const approval of this.deps.tools.listApprovals()) {
      if (approval.status === "pending") continue;
      try {
        const tool = await this.deps.tools.getToolCallDetails(
          approval.toolCallId,
        );
        if (tool.runId || !["committed", "running"].includes(tool.status))
          continue;
        this.wake(
          await this.deps.repository.normalize(tool.conversationId, tool),
          true,
        );
      } catch (error) {
        await this.log(error, {
          conversationId: approval.conversationId,
          toolCallId: approval.toolCallId,
        });
      }
    }
    this.enabled = true;
    for (const value of await this.deps.repository.list())
      this.wake(value, true);
  }

  wake(value: ApprovalSettlement, reconsider = false): void {
    if (
      ["completed", "cancelled"].includes(value.phase) ||
      (stopped.has(value.phase) && !reconsider)
    ) {
      this.due.delete(value.id);
      this.rewokenWhileActive.delete(value.id);
    } else {
      this.due.set(value.id, value);
      if (this.active.has(value.id)) {
        // A run/interaction commit can make an awaiting settlement runnable
        // while its previous pass is still deciding to sleep. Preserve that
        // edge so the old pass cannot delete the only wake-up.
        this.rewokenWhileActive.set(value.id, value);
      }
    }
    this.schedule();
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await Promise.allSettled(this.active.values());
    this.rewokenWhileActive.clear();
    this.due.clear();
  }

  private schedule(): void {
    if (!this.enabled || this.active.size >= 4) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const candidates = [...this.due.values()].filter(
      (value) => !this.active.has(value.id),
    );
    if (!candidates.length) return;
    const delay = Math.max(
      0,
      Math.min(
        ...candidates.map((value) =>
          value.nextAttemptAt
            ? Date.parse(value.nextAttemptAt) - Date.now()
            : 0,
        ),
      ),
    );
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const value of this.due.values()) {
        if (this.active.size >= 4) break;
        if (
          this.active.has(value.id) ||
          (value.nextAttemptAt && Date.parse(value.nextAttemptAt) > Date.now())
        )
          continue;
        const task = this.process(value)
          .catch(async (error: unknown) => {
            this.due.set(value.id, {
              ...value,
              nextAttemptAt: new Date(Date.now() + 30_000).toISOString(),
            });
            await this.log(error, {
              conversationId: value.conversationId,
              runId: value.runId,
            });
          })
          .finally(() => {
            this.active.delete(value.id);
            const rewoken = this.rewokenWhileActive.get(value.id);
            if (rewoken) {
              this.rewokenWhileActive.delete(value.id);
              this.due.set(value.id, rewoken);
            }
            this.schedule();
          });
        this.active.set(value.id, task);
      }
      this.schedule();
    }, delay);
  }

  /** Also used by deterministic fault-injection tests; claims remain revision fenced. */
  async process(reference: ApprovalSettlement): Promise<void> {
    let value = await this.deps.repository.get(
      reference.conversationId,
      reference.id,
    );
    if (!value || ["completed", "cancelled"].includes(value.phase)) {
      this.due.delete(reference.id);
      return;
    }
    try {
      const aggregate = await this.deps.repository.journal.load(
        value.conversationId,
      );
      const projection = value.runId
        ? aggregate.runProjections.get(value.runId)
        : undefined;
      if (
        projection &&
        [
          "cancelled",
          "failed",
          "completed",
          "cancellation_requested",
          "cancellation_failed",
        ].includes(projection.run.status)
      ) {
        await this.deps.repository.update(value, { phase: "cancelled" });
        this.due.delete(value.id);
        return;
      }
      if (value.phase === "blocked") {
        this.due.delete(value.id);
        return;
      }
      if (value.phase === "awaiting_decisions") {
        const checkpointId = value.checkpointId;
        if (
          projection?.interactions.some(
            (item) =>
              item.checkpointId === checkpointId && item.status === "pending",
          )
        ) {
          this.due.delete(value.id);
          return;
        }
        value = await this.deps.repository.update(
          value,
          { phase: "ready" },
          { status: "settling", activeInteractionId: undefined },
        );
      }
      await this.deps.repository.assertContext(value);
      if (value.runId) await this.observe(value);
      if (value.phase !== "continuation_pending") {
        if (value.phase === "ready")
          value = await this.deps.repository.update(value, {
            phase: "executing",
            nextAttemptAt: undefined,
          });
        for (const id of value.toolCallIds) {
          await this.deps.repository.assertContext(value);
          const tool = await this.deps.tools.getToolCallDetails(id);
          if (
            tool.status === "running" ||
            tool.errorDetails?.code === INTERRUPTED_TOOL_ERROR_CODE
          ) {
            throw Object.assign(
              new Error(
                "Execution outcome is unknown. The tool will not be repeated automatically; cancel this run and inspect its effects before starting new work.",
              ),
              { code: "TOOL_EXECUTION_OUTCOME_UNKNOWN" },
            );
          }
          if (terminal.has(tool.status)) continue;
          const approval =
            await this.deps.tools.getApprovalForToolCallDetails(id);
          if (
            !approval ||
            approval.status === "pending" ||
            tool.phase !== "drafted" ||
            tool.attempt !== 0
          ) {
            throw Object.assign(
              new Error(
                "Approval batch contains a tool that cannot safely be executed.",
              ),
              { code: "APPROVAL_BATCH_INVALID" },
            );
          }
          await this.deps.tools.finalizeDecidedApproval(approval.id);
        }
        value = await this.deps.repository.settleResults(value);
      }
      if (value.runId) {
        const current = await this.deps.repository.journal.load(
          value.conversationId,
        );
        if (current.conversation) {
          this.deps.reconcileConversationProjection(
            current.conversation,
            current.entries,
          );
        }
        await this.observe(value);
        await this.deps.runs.continueApprovalSettlement(value);
      }
      this.due.delete(value.id);
    } catch (error) {
      if (error instanceof ConversationJournalRevisionConflictError) {
        const concurrent = await this.deps.repository.get(
          value.conversationId,
          value.id,
        );
        if (
          !concurrent ||
          ["completed", "cancelled"].includes(concurrent.phase)
        ) {
          this.due.delete(value.id);
        } else {
          this.wake(concurrent, true);
        }
        return;
      }
      // A cancelled run or a winning concurrent continuation must not be resurrected.
      const latest = await this.deps.repository.get(
        value.conversationId,
        value.id,
      );
      if (!latest || ["completed", "cancelled"].includes(latest.phase)) {
        this.due.delete(value.id);
        return;
      }
      value = latest;
      const state = await this.deps.repository.journal.load(
        value.conversationId,
      );
      const run = value.runId
        ? state.runProjections.get(value.runId)?.run
        : undefined;
      if (
        run &&
        [
          "cancelled",
          "completed",
          "failed",
          "cancellation_requested",
          "cancellation_failed",
        ].includes(run.status)
      ) {
        await this.deps.repository.update(value, { phase: "cancelled" });
        this.due.delete(value.id);
        return;
      }
      const code =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "APPROVAL_SETTLEMENT_FAILED";
      const attempts = value.attempts + 1;
      const permanent = [
        "RUN_CHECKPOINT_STALE",
        "INVALID_CHECKPOINT",
        "TOOL_EXECUTION_OUTCOME_UNKNOWN",
        "APPROVAL_BATCH_INVALID",
      ].includes(code);
      const blocked = permanent || attempts > 5;
      const failure = {
        code,
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          2000,
        ),
        retryable: !blocked,
      };
      try {
        value = await this.deps.repository.update(
          value,
          {
            phase: blocked ? "blocked" : value.phase,
            attempts,
            failure,
            nextAttemptAt: blocked
              ? undefined
              : new Date(Date.now() + 1000 * 2 ** (attempts - 1)).toISOString(),
          },
          blocked && run
            ? {
                status: "settling",
                failure: { ...failure, continuable: false },
              }
            : undefined,
        );
        this.wake(value);
        if (value.runId) await this.observe(value);
      } catch (persistError) {
        // Storage outage: keep discovery alive, but never redispatch a claimed tool.
        this.due.set(value.id, {
          ...value,
          nextAttemptAt: new Date(Date.now() + 30_000).toISOString(),
        });
        await this.log(persistError, {
          conversationId: value.conversationId,
          runId: value.runId,
        });
      }
      await this.log(error, {
        conversationId: value.conversationId,
        runId: value.runId,
        context: {
          settlementId: value.id,
          phase: value.phase,
          attempts: value.attempts,
          code,
        },
      });
    }
  }

  private async observe(value: ApprovalSettlement): Promise<void> {
    if (!value.runId) return;
    try {
      await this.deps.runs.observeApprovalCommit(value.runId);
    } catch (error) {
      await this.log(error, {
        conversationId: value.conversationId,
        runId: value.runId,
      });
    }
  }

  private async log(
    error: unknown,
    fields: {
      conversationId: string;
      runId?: string;
      toolCallId?: string;
      context?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.deps.logger
      .error("Approval settlement failed", { ...fields, error })
      .catch(() => undefined);
  }
}
