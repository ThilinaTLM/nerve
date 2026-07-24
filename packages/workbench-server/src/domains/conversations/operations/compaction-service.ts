import {
  type AgentMessage,
  buildConversationContext,
  type Conversation,
  type ConversationTreeEntry,
  createCompactionSummaryMessage,
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
  prepareCompaction,
} from "@nervekit/host-runtime/harness";
import type {
  CompactConversationRequest,
  ConversationCompactionReason,
  ConversationEntry,
  ConversationRecord,
  ProjectRecord,
} from "@nervekit/contracts";
import { HttpError } from "../../../http/errors.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import type { ConversationHarnessStorage } from "../conversation-harness-storage.js";
import { buildExtractiveSummary } from "./summary.js";

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

/**
 * Optional LLM summarizer. Returns continuation-focused summary text, or
 * `undefined` to fall back to the local extractive summary (e.g. when model or
 * auth is unavailable).
 */
export type CompactionSummarizer = (input: {
  conversationId: string;
  agentId?: string;
  messages: AgentMessage[];
  previousSummary?: string;
  instructions?: string;
  summaryReserveTokens: number;
  signal?: AbortSignal;
}) => Promise<{ text: string; generatedBy: "model" } | undefined>;

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
    private readonly rebuildConversations: () => Promise<void>,
    private readonly events: StreamLogRegistry,
    private readonly summarize?: CompactionSummarizer,
  ) {}

  async compactConversation(
    conversationId: string,
    request: CompactConversationRequest = {},
    options: CompactConversationOptions = {},
  ): Promise<{ conversation: ConversationRecord; entry: ConversationEntry }> {
    if (this.activeCompactions.has(conversationId)) {
      throw new HttpError(
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
      const project = this.getProject(conversation.projectId);
      const storage =
        options.activeConversation?.getStorage() ??
        (await this.harnessStorage.openStorage(conversation, project.dir));
      throwIfCompactionAborted(operation.controller.signal);
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const branchLeafId = branch.at(-1)?.id ?? null;
      const summaryReserveTokens =
        options.summaryReserveTokens && options.summaryReserveTokens > 0
          ? options.summaryReserveTokens
          : DEFAULT_COMPACTION_SETTINGS.reserveTokens;
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
        throw new HttpError(400, "COMPACTION_FAILED", prepared.error.message);
      }
      if (!prepared.value) {
        throw new HttpError(409, "NOTHING_TO_COMPACT", "Nothing to compact.");
      }
      const preparation = prepared.value;
      let firstKeptEntryId = preparation.firstKeptEntryId;
      let messagesToSummarize = [
        ...preparation.messagesToSummarize,
        ...preparation.turnPrefixMessages,
      ];
      if (messagesToSummarize.length === 0) {
        const messageEntries = branch.filter(
          (
            entry,
          ): entry is Extract<ConversationTreeEntry, { type: "message" }> =>
            entry.type === "message",
        );
        const fallbackKept = messageEntries.at(-1);
        messagesToSummarize = messageEntries
          .slice(0, -1)
          .map((entry) => entry.message);
        if (fallbackKept) firstKeptEntryId = fallbackKept.id;
      }
      if (messagesToSummarize.length === 0) {
        throw new HttpError(
          409,
          "NOTHING_TO_COMPACT",
          "No prior messages to compact.",
        );
      }

      const startedAt = new Date().toISOString();
      let started = false;
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

        const modelSummary = await this.summarizeWithFallback(
          conversationId,
          options.agentId,
          messagesToSummarize,
          preparation.previousSummary,
          request.instructions,
          summaryReserveTokens,
          operation.controller.signal,
        );
        throwIfCompactionAborted(operation.controller.signal);
        const generatedBy =
          modelSummary?.generatedBy ?? "orchestrator-extractive";
        const summary =
          modelSummary?.text ??
          buildExtractiveSummary({
            title: "Context checkpoint",
            messages: messagesToSummarize,
            previousSummary: preparation.previousSummary,
            instructions: request.instructions,
            maxChars: Math.max(1_000, Math.floor(summaryReserveTokens * 3.2)),
          });
        const tokensAfter = estimatePostCompactionTokens(
          branch,
          firstKeptEntryId,
          summary,
          preparation.tokensBefore,
        );
        if (reason !== "manual" && tokensAfter >= preparation.tokensBefore) {
          throw new HttpError(
            409,
            "INEFFECTIVE_COMPACTION",
            "Compaction would not reduce context usage.",
          );
        }
        const freedTokens = Math.max(0, preparation.tokensBefore - tokensAfter);
        const fileOps = {
          read: [...preparation.fileOps.read].sort(),
          written: [...preparation.fileOps.written].sort(),
          edited: [...preparation.fileOps.edited].sort(),
        };
        const details = {
          generatedBy,
          compactedMessages: messagesToSummarize.length,
          splitTurn: preparation.isSplitTurn,
          tokensAfter,
          freedTokens,
          reason,
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
        const entry = await this.appendEntry(
          {
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
          },
          { mirrorToHarness: false },
        );
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
        await this.rebuildConversations();
        await this.events.publish("conversation.compacted", {
          conversationId,
          entry,
          tokensBefore: preparation.tokensBefore,
          firstKeptEntryId,
          reason,
          agentId: options.agentId,
          runId: options.runId,
          contextWindow: options.contextWindow,
          thresholdTokens: options.thresholdTokens,
          keepRecentTokens: settings.keepRecentTokens,
          tokensAfter,
          freedTokens,
        });
        return { conversation: this.getConversation(conversationId), entry };
      } catch (error) {
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

  private async summarizeWithFallback(
    conversationId: string,
    agentId: string | undefined,
    messages: AgentMessage[],
    previousSummary: string | undefined,
    instructions: string | undefined,
    summaryReserveTokens: number,
    signal: AbortSignal,
  ): Promise<{ text: string; generatedBy: "model" } | undefined> {
    if (!this.summarize) return undefined;
    try {
      const summary = await this.summarize({
        conversationId,
        agentId,
        messages,
        previousSummary,
        instructions,
        summaryReserveTokens,
        signal,
      });
      throwIfCompactionAborted(signal);
      return summary?.text.trim()
        ? { text: summary.text.trim(), generatedBy: summary.generatedBy }
        : undefined;
    } catch (error) {
      if (signal.aborted) throw error;
      return undefined;
    }
  }
}

/**
 * Estimate the context-token size of the conversation after compaction: the
 * generated summary plus the retained recent messages. Uses a character-based
 * estimate (not provider usage) because retained assistant usage still reflects
 * the pre-compaction context size.
 */
function estimatePostCompactionTokens(
  branch: ConversationTreeEntry[],
  firstKeptEntryId: string,
  summary: string,
  tokensBefore: number,
): number {
  const keptIndex = branch.findIndex((entry) => entry.id === firstKeptEntryId);
  const keptEntries = keptIndex >= 0 ? branch.slice(keptIndex) : [];
  const keptMessages = buildConversationContext(keptEntries).messages;
  const summaryMessage = createCompactionSummaryMessage(
    summary,
    tokensBefore,
    new Date().toISOString(),
  );
  return [summaryMessage, ...keptMessages].reduce(
    (sum, message) => sum + estimateTokens(message),
    0,
  );
}
