import type {
  ContextUsage,
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  ConversationTree,
  ToolCallRecord,
} from "@nerve/shared";
import type { ConversationRuntime } from "../../conversation-runtime.js";
import type { EventBus } from "../../infrastructure/events/index.js";

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
  events: EventBus;
  conversationRuntime: ConversationRuntime;
  getConversation: (conversationId: string) => ConversationRecord;
  getConversationEntries: (conversationId: string) => ConversationEntry[];
  getConversationTree: (conversationId: string) => ConversationTree;
  getContextUsage: (conversationId: string) => Promise<ContextUsage>;
  listToolCalls: () => ToolCallRecord[];
}

export class ConversationQueryService {
  constructor(private readonly deps: ConversationQueryServiceDeps) {}

  async getConversationSnapshot(
    conversationId: string,
  ): Promise<ConversationSnapshot> {
    const cursorSeq = this.deps.events.latestSeq;
    const contextUsage = await this.deps
      .getContextUsage(conversationId)
      .catch(() => undefined);
    const entries = this.deps.getConversationEntries(conversationId);
    const activeEntryIds = entries.map((entry) => entry.id);
    const activeRun =
      this.deps.conversationRuntime.snapshotForConversation(conversationId);
    return {
      conversation: this.deps.getConversation(conversationId),
      entries,
      activeEntryIds,
      tree: this.deps.getConversationTree(conversationId),
      toolCalls: this.activeBranchToolCalls(
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

  activeBranchToolCalls(
    conversationId: string,
    entries: ConversationEntry[],
    activeRunId: string | undefined,
  ): ToolCallRecord[] {
    const runIds = new Set(
      entries.flatMap((entry) => (entry.runId ? [entry.runId] : [])),
    );
    const toolIds = toolRecordIdsFromEntries(entries);
    return this.deps.listToolCalls().filter((toolCall) => {
      if (toolCall.conversationId !== conversationId) return false;
      if (activeRunId && toolCall.runId === activeRunId) return true;
      if (toolCall.runId && runIds.has(toolCall.runId)) return true;
      if (toolIds.has(toolCall.id)) return true;
      if (toolCall.sourceToolCallId && toolIds.has(toolCall.sourceToolCallId))
        return true;
      if (
        toolCall.providerToolCallId &&
        toolIds.has(toolCall.providerToolCallId)
      )
        return true;
      return false;
    });
  }
}
