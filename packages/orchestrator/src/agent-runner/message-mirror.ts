import type {
  AgentMessage,
  ConversationTreeEntry,
  JsonlConversationStorage,
} from "@nerve/agent";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationEntryUsage,
  ConversationRecord,
} from "@nerve/shared";
import { deriveConversationTitle } from "../conversation-operations/index.js";
import type { EventBus } from "../events.js";

export interface AppendEntryInput {
  id?: string;
  conversationId: string;
  agentId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  parentEntryId?: string | null;
  role: ConversationEntry["role"];
  kind?: ConversationEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  usage?: ConversationEntryUsage;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
}

export type AppendEntryFn = (
  input: AppendEntryInput,
  options?: { mirrorToHarness?: boolean },
) => Promise<ConversationEntry>;

export interface MessageMirrorDeps {
  entries: Map<string, ConversationEntry[]>;
  conversations: Map<string, ConversationRecord>;
  appendEntry: AppendEntryFn;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  events: EventBus;
}

export class MessageMirror {
  constructor(private readonly deps: MessageMirrorDeps) {}

  async mirrorNewHarnessEntries(
    agent: AgentRecord,
    storage: JsonlConversationStorage,
    knownEntryIds: Set<string>,
    metadata: { runId?: string; turnId?: string; liveMessageId?: string } = {},
  ): Promise<ConversationEntry[]> {
    const mirrored: ConversationEntry[] = [];
    const storageEntries = await storage.getEntries();
    const visibleEntryIds = new Set(
      (this.deps.entries.get(agent.conversationId) ?? []).map(
        (entry) => entry.id,
      ),
    );
    for (const entry of storageEntries) {
      if (knownEntryIds.has(entry.id)) continue;
      knownEntryIds.add(entry.id);
      if (entry.type !== "message") continue;
      if (
        entry.message.role !== "user" &&
        entry.message.role !== "assistant" &&
        entry.message.role !== "toolResult"
      ) {
        continue;
      }
      const role: ConversationEntry["role"] =
        entry.message.role === "toolResult" ? "system" : entry.message.role;
      const uiEntry = await this.deps.appendEntry(
        {
          id: entry.id,
          conversationId: agent.conversationId,
          agentId: agent.id,
          runId: metadata.runId,
          turnId: metadata.turnId,
          liveMessageId:
            role === "assistant" ? metadata.liveMessageId : undefined,
          parentEntryId: resolveVisibleParentId(
            entry.parentId,
            storageEntries,
            visibleEntryIds,
          ),
          role,
          text: agentMessageText(entry.message as AgentMessage),
          usage: extractEntryUsage(entry.message as AgentMessage),
          details: entryDetails(entry.message as AgentMessage),
          createdAt: entry.timestamp,
        },
        { mirrorToHarness: false },
      );
      visibleEntryIds.add(uiEntry.id);
      mirrored.push(uiEntry);
    }
    return mirrored;
  }

  async maybeDeriveInitialConversationTitle(
    conversationId: string,
    text: string,
  ): Promise<void> {
    const conversation = this.deps.conversations.get(conversationId);
    if (!conversation) return;
    const userEntryCount = (
      this.deps.entries.get(conversation.id) ?? []
    ).filter((entry) => entry.role === "user").length;
    if (userEntryCount !== 1) return;
    const title = deriveConversationTitle(text);
    if (!title || title === conversation.title) return;
    await this.deps.updateConversation({
      ...conversation,
      title,
      updatedAt: new Date().toISOString(),
    });
    await this.deps.events.publish("conversation.updated", {
      conversation: this.deps.conversations.get(conversation.id),
    });
  }
}

function resolveVisibleParentId(
  parentId: string | null | undefined,
  storageEntries: ConversationTreeEntry[],
  visibleEntryIds: Set<string>,
): string | undefined {
  const rawEntriesById = new Map(
    storageEntries.map((entry) => [entry.id, entry]),
  );
  let cursor = parentId ?? undefined;
  while (cursor) {
    if (visibleEntryIds.has(cursor)) return cursor;
    cursor = rawEntriesById.get(cursor)?.parentId ?? undefined;
  }
  return undefined;
}

function entryDetails(message: AgentMessage): unknown {
  if (message.role === "toolResult") {
    return {
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      isError: message.isError,
      toolRecordId: toolRecordIdFromDetails(message.details),
      details: message.details,
    };
  }
  if (message.role !== "assistant") return undefined;
  const thinkingBlocks = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => ({ text: part.thinking, redacted: part.redacted }))
    .filter((part) => part.text.length > 0 || part.redacted === true);
  return thinkingBlocks.length > 0 ? { thinkingBlocks } : undefined;
}

function extractEntryUsage(
  message: AgentMessage,
): ConversationEntryUsage | undefined {
  if (message.role !== "assistant") return undefined;
  if (message.stopReason === "aborted" || message.stopReason === "error") {
    return undefined;
  }
  const usage = message.usage;
  if (!usage) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens:
      usage.totalTokens ||
      usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    cost: usage.cost?.total ?? 0,
  };
}

function toolRecordIdFromDetails(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const toolCall = (details as { toolCall?: { id?: unknown } }).toolCall;
  return typeof toolCall?.id === "string" && toolCall.id.startsWith("tool_")
    ? toolCall.id
    : undefined;
}

export function agentMessageText(message: AgentMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  if (message.role === "assistant") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.trim()) return text;
    const toolCalls = message.content
      .filter((part) => part.type === "toolCall")
      .map((part) => `${part.name}(${JSON.stringify(part.arguments)})`);
    return toolCalls.length > 0 ? `[Tool call: ${toolCalls.join(", ")}]` : "";
  }
  if (message.role === "toolResult") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return text || `[Tool result: ${message.toolName}]`;
  }
  return "";
}
