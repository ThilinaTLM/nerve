import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  resolveCompactionOwner,
  type CompactionCommitGuard,
} from "../compaction-owner.js";
import { type AgentMessage } from "@nervekit/harness/agent";
import {
  type Conversation,
  type ConversationTreeEntry,
} from "@nervekit/harness/conversation";
import {
  type CompactionSummaryProfile,
  DEFAULT_COMPACTION_SETTINGS,
  estimatePostCompactionContext,
  summaryBudget,
  summaryDefects,
  prepareCompaction,
  planCompaction,
  assessCompactionUsefulness,
  deriveManualCompactionSettings,
} from "@nervekit/harness/compaction";
import { createId } from "@nervekit/contracts";
import type {
  CompactionAccounting,
  CheckpointDetails,
  AnchorOverflow,
  CompactConversationRequest,
  ConversationCompactionReason,
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { ApplicationError } from "../../../core/application-error.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { ConversationHarnessStorage } from "../conversation-harness-storage.js";
import {
  CompactionProgressPublisher,
  type CompactionProgressPublisherOptions,
  type CompactionProgressReport,
} from "./compaction-progress-publisher.js";
export interface AppendConversationEntryInput {
  id?: string;
  conversationId: string;
  agentId?: string;
  runId?: string;
  parentEntryId?: string | null;
  role: ConversationEntry["role"];
  kind?: ConversationEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
}

export type AppendConversationEntry = (
  input: AppendConversationEntryInput,
  options?: { mirrorToHarness?: boolean },
) => Promise<ConversationEntry>;

/** Missing or failed summarization must leave the existing context intact. */
export type CompactionSummarizer = (input: {
  conversationId: string;
  agentId?: string;
  messages: AgentMessage[];
  previousSummary?: string;
  turnPrefixMessages?: AgentMessage[];
  fileReferences?: string[];
  instructions?: string;
  summaryProfile?: CompactionSummaryProfile;
  summaryReserveTokens: number;
  anchorOverflow?: AnchorOverflow[];
  abandonedToolCallIds?: string[];
  signal?: AbortSignal;
  /** Receives the summary text as it streams in, for live UI feedback. */
  onProgress?: (progress: CompactionProgressReport) => void;
}) => Promise<
  | {
      text: string;
      generatedBy: "model";
      summaryRepaired?: boolean;
      summaryBudget?: { target: number; ceiling: number };
    }
  | undefined
>;

export interface CompactConversationOptions {
  reason?: ConversationCompactionReason;
  agentId?: string;
  runId?: string;
  contextWindow?: number;
  contextTokens?: number;
  pendingPromptTokens?: number;
  thresholdTokens?: number;
  triggerReserveTokens?: number;
  keepRecentTokens?: number;
  summaryReserveTokens?: number;
  profile?: string;
  thresholdPercent?: number;
  keepRecentPercent?: number;
  safetyHeadroomTokens?: number;
  failedEntryId?: string;
  activeConversation?: Conversation;
  summaryProfile?: CompactionSummaryProfile;
  sourceReviewId?: string;
  signal?: AbortSignal;
}

function failureCode(
  error: unknown,
): "ineffective" | "stale" | "pending_work" | "no_new_history" | undefined {
  if (!(error instanceof ApplicationError)) return undefined;
  switch (error.code) {
    case "COMPACTION_PREFLIGHT_INEFFECTIVE":
    case "INEFFECTIVE_COMPACTION":
      return "ineffective";
    case "STALE_COMPACTION":
      return "stale";
    case "COMPACTION_PENDING_WORK":
    case "COMPACTION_OWNER_BUSY":
      return "pending_work";
    case "NOTHING_TO_COMPACT":
      return "no_new_history";
    default:
      return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfCompactionAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Compaction cancelled.");
}

export type CompactionOutcome =
  | { status: "compacted"; reason: "checkpoint_committed" }
  | {
      status: "not_needed";
      reason:
        | "auto_disabled"
        | "policy_disabled"
        | "below_threshold"
        | "no_new_history"
        | "ineffective";
    }
  | { status: "deferred"; reason: "in_progress" | "pending_work" }
  | { status: "blocked"; reason: "pending_work" | "invalid_overflow_source" }
  | { status: "failed"; reason: "stale" | "ineffective" | "summary_failed" }
  | { status: "cancelled"; reason: "aborted" };

/** Only expected domain refusals become outcomes; programming/storage faults propagate. */
export function compactionFailureOutcome(
  error: unknown,
  signal?: AbortSignal,
): CompactionOutcome {
  if (signal?.aborted) return { status: "cancelled", reason: "aborted" };
  if (!(error instanceof ApplicationError)) throw error;
  switch (error.code) {
    case "COMPACTION_PENDING_WORK":
      return { status: "deferred", reason: "pending_work" };
    case "COMPACTION_PREFLIGHT_INEFFECTIVE":
      return { status: "not_needed", reason: "ineffective" };
    case "COMPACTION_IN_PROGRESS":
      return { status: "deferred", reason: "in_progress" };
    case "NOTHING_TO_COMPACT":
      return { status: "not_needed", reason: "no_new_history" };
    case "COMPACTION_CANCELLED":
      return { status: "cancelled", reason: "aborted" };
    case "INVALID_OVERFLOW_SOURCE":
      return { status: "blocked", reason: "invalid_overflow_source" };
    case "COMPACTION_OWNER_BUSY":
      return { status: "blocked", reason: "pending_work" };
    case "STALE_COMPACTION":
      return { status: "failed", reason: "stale" };
    case "INEFFECTIVE_COMPACTION":
      return { status: "failed", reason: "ineffective" };
    case "COMPACTION_FAILED":
      return { status: "failed", reason: "summary_failed" };
    default:
      throw error;
  }
}

type ActiveCompaction = {
  controller: AbortController;
  committing: boolean;
  completion: Promise<void>;
  complete: () => void;
};

export class CompactionService {
  private readonly activeCompactions = new Map<string, ActiveCompaction>();

  constructor(
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly appendEntry: AppendConversationEntry,
    private readonly harnessStorage: ConversationHarnessStorage,
    private readonly rebuildConversation: (
      conversationId: string,
    ) => Promise<void>,
    private readonly events: StreamLogRegistry,
    private readonly summarize?: CompactionSummarizer,
    private readonly progressOptions: CompactionProgressPublisherOptions = {},
    private readonly appendCompactionAtomic?: (
      input: AppendConversationEntryInput & { id: string; createdAt: string },
      modelEntry: ConversationTreeEntry,
      guard: CompactionCommitGuard,
    ) => Promise<ConversationEntry>,
    private readonly getAgent?: (agentId: string) => AgentRecord,
    private readonly hasNonterminalOwnerRun?: (
      conversationId: string,
      ownerAgentId?: string,
    ) => Promise<boolean>,
    private readonly manualPolicy?: (
      conversationId: string,
      agentId?: string,
    ) => Promise<{ contextWindow: number; settings: AutoCompactionSettings }>,
  ) {}

  private resolveOwner(conversationId: string, agentId?: string) {
    if (agentId && !this.getAgent)
      throw new Error("Compaction owner resolver is required.");
    return resolveCompactionOwner(
      conversationId,
      agentId ? this.getAgent!(agentId) : undefined,
    );
  }

  async compactConversation(
    conversationId: string,
    request: CompactConversationRequest = {},
    options: CompactConversationOptions = {},
  ): Promise<{ conversation: ConversationRecord; entry: ConversationEntry }> {
    const agentId = options.agentId ?? request.agentId;
    options = { ...options, agentId };
    const owner = this.resolveOwner(conversationId, agentId);
    const scopeKey = owner.key;
    if (this.activeCompactions.has(scopeKey)) {
      throw new ApplicationError(
        409,
        "COMPACTION_IN_PROGRESS",
        "Conversation compaction is already in progress.",
      );
    }

    const reason = options.reason ?? "manual";
    if (!this.appendCompactionAtomic)
      throw new Error("Guarded compaction commit is required.");
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const operation: ActiveCompaction = {
      controller: new AbortController(),
      committing: false,
      completion,
      complete,
    };
    this.activeCompactions.set(scopeKey, operation);
    const abortFromOwner = () =>
      operation.controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromOwner();
    else
      options.signal?.addEventListener("abort", abortFromOwner, { once: true });

    let started = false;
    try {
      if (
        reason === "manual" &&
        !options.sourceReviewId &&
        (await this.hasNonterminalOwnerRun?.(
          conversationId,
          owner.ownerAgentId,
        ))
      ) {
        throw new ApplicationError(
          409,
          "COMPACTION_OWNER_BUSY",
          "Cannot compact an owner with a nonterminal run.",
        );
      }
      const conversation = this.getConversation(conversationId);
      const storage =
        options.activeConversation?.getStorage() ??
        (owner.ownerAgentId
          ? await this.harnessStorage.openAgentStorage(
              this.getAgent!(owner.ownerAgentId),
            )
          : await this.harnessStorage.openStorage(conversation));
      throwIfCompactionAborted(operation.controller.signal);
      const expectedModelLeafId = await storage.getLeafId();
      const guard: CompactionCommitGuard = {
        ownerAgentId: owner.ownerAgentId,
        expectedModelLeafId,
        ...(!owner.ownerAgentId
          ? { expectedActiveEntryId: conversation.activeEntryId ?? null }
          : {}),
      };
      let sourceLeafId = expectedModelLeafId;
      if (options.failedEntryId) {
        const failed = expectedModelLeafId
          ? await storage.getEntry(expectedModelLeafId)
          : undefined;
        if (
          reason !== "overflow" ||
          failed?.id !== options.failedEntryId ||
          failed.type !== "message" ||
          failed.message.role !== "assistant" ||
          failed.message.stopReason !== "error" ||
          !failed.parentId
        ) {
          throw new ApplicationError(
            409,
            "INVALID_OVERFLOW_SOURCE",
            "Overflow source must be the current failed assistant with a parent.",
          );
        }
        if (!(await storage.getEntry(failed.parentId)))
          throw new ApplicationError(
            409,
            "INVALID_OVERFLOW_SOURCE",
            "Overflow assistant parent is missing.",
          );
        sourceLeafId = failed.parentId;
      }
      // Preflight seam: immutable owner path + protected provider IDs feed the pure planner here.
      const branch = structuredClone(await storage.getPathToRoot(sourceLeafId));
      const branchLeafId = branch.at(-1)?.id ?? null;
      const manualPolicy =
        reason === "manual"
          ? await this.manualPolicy?.(conversationId, options.agentId)
          : undefined;
      const contextWindow =
        options.contextWindow ?? manualPolicy?.contextWindow;
      options = { ...options, contextWindow };
      const defaults =
        reason === "manual"
          ? deriveManualCompactionSettings(
              contextWindow ?? 0,
              manualPolicy?.settings,
            )
          : DEFAULT_COMPACTION_SETTINGS;
      const summaryReserveTokens =
        options.summaryReserveTokens ?? defaults.reserveTokens;
      const settings = {
        ...defaults,
        reserveTokens: summaryReserveTokens,
        keepRecentTokens:
          request.keepRecentTokens ??
          options.keepRecentTokens ??
          defaults.keepRecentTokens,
      };
      const protectedToolCallIds =
        await this.harnessStorage.pendingProviderToolCallIds(
          conversationId,
          owner.ownerAgentId,
          (id) => {
            if (!this.getAgent)
              throw new Error("Compaction agent lookup is required.");
            return this.getAgent(id);
          },
        );
      const planningOptions = { protectedToolCallIds, contextWindow };
      const plan = planCompaction(
        branch,
        settings.keepRecentTokens,
        planningOptions,
      );
      if (plan.status === "deferred")
        throw new ApplicationError(
          409,
          "COMPACTION_PENDING_WORK",
          "Compaction is deferred while owner tool work is pending.",
        );
      if (!plan.advances)
        throw new ApplicationError(
          409,
          "NOTHING_TO_COMPACT",
          "No new history can be compacted.",
        );
      const prepared = prepareCompaction(branch, settings, planningOptions);
      if (!prepared.ok)
        throw new ApplicationError(
          400,
          "COMPACTION_FAILED",
          prepared.error.message,
        );
      if (!prepared.value)
        throw new ApplicationError(
          409,
          "NOTHING_TO_COMPACT",
          "Nothing to compact.",
        );
      const preparation = prepared.value;
      const checkpointDetails: CheckpointDetails = {
        anchors: plan.anchors,
        anchorOverflow: plan.anchorOverflow,
        knownToolCallIds: plan.knownToolCallIds,
      };
      const firstKeptEntryId = preparation.firstKeptEntryId;
      const messagesToSummarize = preparation.messagesToSummarize;
      const budget = summaryBudget(summaryReserveTokens);
      if (reason === "threshold") {
        const usefulness = assessCompactionUsefulness({
          tokensBefore: preparation.tokensBefore,
          retainedTokens: plan.retainedTokens,
          checkpointTokens: budget.ceiling + plan.checkpointOverheadTokens,
          advances: plan.advances,
          pendingPromptTokens: options.pendingPromptTokens,
          thresholdTokens: options.thresholdTokens,
        });
        if (!usefulness.useful)
          throw new ApplicationError(
            409,
            usefulness.reason === "no_new_history"
              ? "NOTHING_TO_COMPACT"
              : "COMPACTION_PREFLIGHT_INEFFECTIVE",
            "No useful threshold compaction is available; context was not changed.",
          );
      }

      const startedAt = new Date().toISOString();
      const progress = new CompactionProgressPublisher(
        this.events,
        {
          conversationId,
          agentId: options.agentId,
          runId: options.runId,
          reason,
        },
        this.progressOptions,
      );
      const flushProgress = () => progress.flush().catch(() => undefined);
      try {
        await this.events.publish("conversation.compaction.started", {
          conversationId,
          agentId: options.agentId,
          runId: options.runId,
          reason,
          startedAt,
          contextWindow: options.contextWindow,
          contextTokens: options.contextTokens ?? preparation.tokensBefore,
          thresholdTokens: options.thresholdTokens,
          triggerReserveTokens: options.triggerReserveTokens,
          keepRecentTokens: settings.keepRecentTokens,
          failedEntryId: options.failedEntryId,
        });
        started = true;

        if (!this.summarize)
          throw new ApplicationError(
            409,
            "COMPACTION_FAILED",
            "No compaction summarizer is available; context was not changed.",
          );
        const modelSummary = await this.summarize({
          conversationId,
          agentId: options.agentId,
          messages: messagesToSummarize,
          turnPrefixMessages: preparation.turnPrefixMessages,
          previousSummary: preparation.previousSummary,
          instructions: request.instructions,
          fileReferences: [
            ...preparation.fileOps.edited,
            ...preparation.fileOps.written,
            ...preparation.fileOps.read,
          ],
          summaryProfile: options.summaryProfile,
          summaryReserveTokens,
          anchorOverflow: plan.anchorOverflow,
          abandonedToolCallIds: plan.abandonedToolCallIds,
          signal: operation.controller.signal,
          onProgress: (report) => progress.report(report),
        })
          .catch((error: unknown) => {
            if (operation.controller.signal.aborted) throw error;
            throw new ApplicationError(
              502,
              "COMPACTION_FAILED",
              "Summary generation failed; context was not changed. Check model availability and retry.",
            );
          })
          .finally(flushProgress);
        throwIfCompactionAborted(operation.controller.signal);
        if (!modelSummary)
          throw new ApplicationError(
            409,
            "COMPACTION_FAILED",
            "A model and authentication are required for compaction; context was not changed.",
          );
        const summary = modelSummary.text.trim();
        const defects = summaryDefects(summary, budget.ceiling);
        if (defects.length)
          throw new ApplicationError(
            409,
            "COMPACTION_FAILED",
            `Invalid checkpoint: ${defects.join("; ")}`,
          );
        const generatedBy = modelSummary.generatedBy;
        const estimate = estimatePostCompactionContext(
          branch,
          firstKeptEntryId,
          summary,
          checkpointDetails,
          planningOptions,
        );
        const { tokensAfter } = estimate;
        const usefulness = assessCompactionUsefulness({
          tokensBefore: estimate.tokensBeforeEstimate,
          retainedTokens: estimate.retainedTokens,
          checkpointTokens: estimate.summaryTokens,
          advances: plan.advances,
          ...(reason === "threshold"
            ? {
                pendingPromptTokens: options.pendingPromptTokens,
                thresholdTokens: options.thresholdTokens,
              }
            : {}),
        });
        if (!usefulness.useful)
          throw new ApplicationError(
            409,
            usefulness.reason === "no_new_history"
              ? "NOTHING_TO_COMPACT"
              : "INEFFECTIVE_COMPACTION",
            "Compaction would not produce useful context reduction; context was not changed.",
          );
        const accounting: CompactionAccounting = {
          estimatorVersion: 1,
          scope: "conversation",
          summaryTokens: estimate.summaryTokens,
          retainedTokens: estimate.retainedTokens,
          retainedMessages: estimate.retainedMessages,
          retentionTarget: settings.keepRecentTokens,
          retentionBudgetExceeded:
            estimate.retainedTokens > settings.keepRecentTokens,
          summaryTarget: Math.min(
            budget.target,
            modelSummary.summaryBudget?.target ?? budget.target,
          ),
          summaryCeiling: Math.min(
            budget.ceiling,
            modelSummary.summaryBudget?.ceiling ?? budget.ceiling,
          ),
          summaryRepaired: modelSummary.summaryRepaired ?? false,
          anchorTokens: estimate.anchorTokens,
          anchorOverflow: plan.anchorOverflow,
        };
        const freedTokens = Math.max(0, preparation.tokensBefore - tokensAfter);
        const fileOps = {
          read: [...preparation.fileOps.read].sort(),
          written: [...preparation.fileOps.written].sort(),
          edited: [...preparation.fileOps.edited].sort(),
        };
        const details = {
          ...checkpointDetails,
          generatedBy,
          accounting,
          compactedMessages:
            messagesToSummarize.length + preparation.turnPrefixMessages.length,
          splitTurn: preparation.isSplitTurn,
          tokensAfter,
          freedTokens,
          reason,
          sourceReviewId: options.sourceReviewId,
          summaryProfile: options.summaryProfile?.kind,
          policy: {
            contextWindow: options.contextWindow,
            thresholdTokens: options.thresholdTokens,
            triggerReserveTokens: options.triggerReserveTokens,
            keepRecentTokens: settings.keepRecentTokens,
            summaryReserveTokens,
            profile: options.profile,
            thresholdPercent: options.thresholdPercent,
            keepRecentPercent: options.keepRecentPercent,
            safetyHeadroomTokens: options.safetyHeadroomTokens,
          },
          fileOps,
          readFiles: fileOps.read,
          modifiedFiles: Array.from(
            new Set([...fileOps.written, ...fileOps.edited]),
          ).sort(),
        };
        throwIfCompactionAborted(operation.controller.signal);
        operation.committing = true;
        const baseEntryInput: AppendConversationEntryInput = {
          conversationId,
          agentId: options.agentId,
          runId: options.runId,
          parentEntryId: branchLeafId,
          role: "system",
          kind: "compaction",
          text: summary,
          summary,
          tokensBefore: preparation.tokensBefore,
          firstKeptEntryId,
          details,
        };
        const entryId = createId("entry");
        const createdAt = new Date().toISOString();
        const modelEntry: ConversationTreeEntry = {
          type: "compaction",
          id: entryId,
          parentId: branchLeafId,
          timestamp: createdAt,
          summary,
          firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          details,
        };
        const entry = await this.appendCompactionAtomic(
          { ...baseEntryInput, id: entryId, createdAt },
          modelEntry,
          guard,
        );
        await this.rebuildConversation(conversationId);
        await this.events.publish("conversation.compacted", {
          conversationId,
          entryId: entry.id,
          tokensBefore: preparation.tokensBefore,
          firstKeptEntryId,
          reason,
          agentId: options.agentId,
          runId: options.runId,
          contextWindow: options.contextWindow,
          thresholdTokens: options.thresholdTokens,
          keepRecentTokens: settings.keepRecentTokens,
          accounting,
          tokensAfter,
          freedTokens,
        });
        return { conversation: this.getConversation(conversationId), entry };
      } catch (error) {
        await flushProgress();
        if (started) {
          const cancelled =
            operation.controller.signal.aborted && !operation.committing;
          await this.events
            .publish(
              cancelled
                ? "conversation.compaction.cancelled"
                : "conversation.compaction.failed",
              cancelled
                ? {
                    conversationId,
                    agentId: options.agentId,
                    runId: options.runId,
                    reason,
                    cancelledAt: new Date().toISOString(),
                    failedEntryId: options.failedEntryId,
                  }
                : {
                    conversationId,
                    agentId: options.agentId,
                    runId: options.runId,
                    reason,
                    failedAt: new Date().toISOString(),
                    message: errorMessage(error),
                    code: failureCode(error),
                    failedEntryId: options.failedEntryId,
                  },
            )
            .catch(() => undefined);
        }
        throw error;
      }
    } catch (error) {
      if (
        !started &&
        reason === "manual" &&
        !operation.controller.signal.aborted
      ) {
        await this.events.publish("conversation.compaction.failed", {
          conversationId,
          agentId: options.agentId,
          runId: options.runId,
          reason,
          failedAt: new Date().toISOString(),
          message: errorMessage(error),
          code: failureCode(error),
        });
      }
      if (operation.controller.signal.aborted && !operation.committing) {
        throw new ApplicationError(
          499,
          "COMPACTION_CANCELLED",
          "Compaction cancelled.",
        );
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abortFromOwner);
      if (this.activeCompactions.get(scopeKey) === operation) {
        this.activeCompactions.delete(scopeKey);
      }
      operation.complete();
    }
  }

  async cancelCompaction(
    conversationId: string,
    agentId?: string,
  ): Promise<boolean> {
    const operation = this.activeCompactions.get(
      this.resolveOwner(conversationId, agentId).key,
    );
    if (!operation || operation.committing) return false;
    operation.controller.abort(new Error("Compaction cancelled."));
    await operation.completion;
    return true;
  }
}
