import { conversationStream } from "@nervekit/contracts/events";
import type { ConversationActivitySnapshot } from "@nervekit/contracts/agents";
import { type ContextUsage } from "@nervekit/contracts/models";
import {
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationSnapshot,
  ConversationTree,
} from "@nervekit/contracts/conversations";
import { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { RuntimeState } from "../../app/runtime/runtime-projections.js";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function toolRecordIdsFromEntries(
  entries: ConversationEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const details = recordValue(entry.details);
    if (!details) continue;
    for (const value of [details.toolRecordId, details.toolCallId]) {
      const id = stringValue(value);
      if (id) ids.add(id);
    }
    const nestedDetails = recordValue(details.details);
    const nestedToolCall = recordValue(nestedDetails?.toolCall);
    const nestedId = stringValue(nestedToolCall?.id);
    if (nestedId) ids.add(nestedId);
  }
  return ids;
}

export interface ConversationQueryServiceDeps {
  events: StreamLogRegistry;
  state: RuntimeState;
  getConversationEntries: (
    conversationId: string,
  ) => Promise<ConversationEntry[]>;
  getConversationRevision: (conversationId: string) => Promise<number>;
  getConversationTree: (conversationId: string) => ConversationTree;
  enrichConversationTree: (tree: ConversationTree) => Promise<ConversationTree>;
  getContextUsage: (conversationId: string) => Promise<ContextUsage>;
  listToolCallPreviews: (
    conversationId: string,
  ) => Promise<ToolCallTranscriptRecord[]>;
  getActiveRun: (
    conversationId: string,
    activeEntryIds: readonly string[],
  ) => Promise<ConversationActiveRunSnapshot | undefined>;
  getActivity(conversationId: string): Promise<ConversationActivitySnapshot>;
}

export class ConversationQueryService {
  constructor(private readonly deps: ConversationQueryServiceDeps) {}

  async getConversationSnapshot(
    conversationId: string,
  ): Promise<ConversationSnapshot> {
    const [cursorSeq, conversationRevision, activity] = await Promise.all([
      this.deps.events.latestSeq(conversationStream(conversationId)),
      this.deps.getConversationRevision(conversationId),
      this.deps.getActivity(conversationId),
    ]);
    const contextUsage = await this.deps
      .getContextUsage(conversationId)
      .catch(() => undefined);
    const entries = await this.deps.getConversationEntries(conversationId);
    const activeEntryIds = entries.map((entry) => entry.id);
    const activeRun = await this.deps.getActiveRun(
      conversationId,
      activeEntryIds,
    );
    return {
      conversation: this.deps.state.getConversation(conversationId),
      activity,
      conversationRevision,
      entries,
      activeEntryIds,
      tree: await this.getConversationTree(conversationId),
      toolCalls: await this.activeBranchToolCalls(
        conversationId,
        entries,
        activeRun?.runId,
      ),
      activeRun,
      contextUsage,
      cursorSeq,
      generatedAt: new Date().toISOString(),
    };
  }

  async getConversationTree(conversationId: string): Promise<ConversationTree> {
    return this.deps.enrichConversationTree(
      this.deps.getConversationTree(conversationId),
    );
  }

  async activeBranchToolCalls(
    conversationId: string,
    entries: ConversationEntry[],
    activeRunId: string | undefined,
  ): Promise<ToolCallTranscriptRecord[]> {
    const toolIds = toolRecordIdsFromEntries(entries);
    return (await this.deps.listToolCallPreviews(conversationId)).filter(
      (toolCall) => {
        if (toolCall.conversationId !== conversationId) return false;
        if (toolCall.hidden) return false;
        if (activeRunId && toolCall.runId === activeRunId) return true;
        if (toolIds.has(toolCall.id)) return true;
        if (toolCall.sourceToolCallId && toolIds.has(toolCall.sourceToolCallId))
          return true;
        if (
          toolCall.providerToolCallId &&
          toolIds.has(toolCall.providerToolCallId)
        )
          return true;
        return false;
      },
    );
  }
}
