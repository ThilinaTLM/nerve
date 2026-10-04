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
} from "@nervekit/harness/compaction";
import { createId } from "@nervekit/contracts";
import type {
  CompactionAccounting,
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
  signal?: AbortSignal;
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
    ) => Promise<ConversationEntry>,
  ) {}

  async compactConversation(
    conversationId: string,
    request: CompactConversationRequest = {},
    options: CompactConversationOptions = {},
  ): Promise<{ conversation: ConversationRecord; entry: ConversationEntry }> {
    if (this.activeCompactions.has(conversationId)) {
      throw new ApplicationError(
        409,
        "COMPACTION_IN_PROGRESS",
        "Conversation compaction is already in progress.",
      );
    }

    const reason = options.reason ?? "manual";
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
    this.activeCompactions.set(conversationId, operation);
    const abortFromOwner = () =>
      operation.controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromOwner();
    else
      options.signal?.addEventListener("abort", abortFromOwner, { once: true });

    try {
      const conversation = this.getConversation(conversationId);
      const storage =
        options.activeConversation?.getStorage() ??
        (await this.harnessStorage.openStorage(conversation));
      throwIfCompactionAborted(operation.controller.signal);
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const branchLeafId = branch.at(-1)?.id ?? null;
      const summaryReserveTokens =
        options.summaryReserveTokens ??
        DEFAULT_COMPACTION_SETTINGS.reserveTokens;
      const settings = {
        ...DEFAULT_COMPACTION_SETTINGS,
        reserveTokens: summaryReserveTokens,
        keepRecentTokens:
          request.keepRecentTokens ??
          (options.keepRecentTokens && options.keepRecentTokens > 0
            ? options.keepRecentTokens
            : DEFAULT_COMPACTION_SETTINGS.keepRecentTokens),
      };
      const prepared = prepareCompaction(branch, settings);
      if (!prepared.ok) {
        throw new ApplicationError(
          400,
          "COMPACTION_FAILED",
          prepared.error.message,
        );
      }
      if (!prepared.value) {
        throw new ApplicationError(
          409,
          "NOTHING_TO_COMPACT",
          "Nothing to compact.",
        );
      }
      const preparation = prepared.value;
      const firstKeptEntryId = preparation.firstKeptEntryId;
      const messagesToSummarize = preparation.messagesToSummarize;
      const budget = summaryBudget(summaryReserveTokens);

      const startedAt = new Date().toISOString();
      let started = false;
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
        );
        const { tokensAfter } = estimate;
        if (tokensAfter >= estimate.tokensBeforeEstimate) {
          throw new ApplicationError(
            409,
            "INEFFECTIVE_COMPACTION",
            "Compaction would not reduce retained context; context was not changed.",
          );
        }
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
        };
        const freedTokens = Math.max(0, preparation.tokensBefore - tokensAfter);
        const fileOps = {
          read: [...preparation.fileOps.read].sort(),
          written: [...preparation.fileOps.written].sort(),
          edited: [...preparation.fileOps.edited].sort(),
        };
        const details = {
          generatedBy,
          accounting,
          compactedMessages:
            messagesToSummarize.length + preparation.turnPrefixMessages.length,
          splitTurn: preparation.isSplitTurn,
          tokensAfter,
          freedTokens,
          reason,
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
        let entry: ConversationEntry;
        if (this.appendCompactionAtomic) {
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
          entry = await this.appendCompactionAtomic(
            { ...baseEntryInput, id: entryId, createdAt },
            modelEntry,
          );
        } else {
          entry = await this.appendEntry(baseEntryInput, {
            mirrorToHarness: false,
          });
          await storage.appendEntry({
            type: "compaction",
            id: entry.id,
            parentId: entry.parentEntryId ?? null,
            timestamp: entry.createdAt,
            summary,
            firstKeptEntryId,
            tokensBefore: preparation.tokensBefore,
            details,
          });
        }
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
                    failedEntryId: options.failedEntryId,
                  },
            )
            .catch(() => undefined);
        }
        throw error;
      }
    } finally {
      options.signal?.removeEventListener("abort", abortFromOwner);
      if (this.activeCompactions.get(conversationId) === operation) {
        this.activeCompactions.delete(conversationId);
      }
      operation.complete();
    }
  }

  async cancelCompaction(conversationId: string): Promise<boolean> {
    const operation = this.activeCompactions.get(conversationId);
    if (!operation || operation.committing) return false;
    operation.controller.abort(new Error("Compaction cancelled."));
    await operation.completion;
    return true;
  }
}
