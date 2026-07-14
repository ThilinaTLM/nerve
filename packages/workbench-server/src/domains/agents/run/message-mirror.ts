import type {
  AgentMessage,
  ConversationTreeEntry,
  JsonlConversationStorage,
} from "@nervekit/host-runtime/harness";
import type {
  AgentRecord,
  ConversationEntry,
  ConversationEntryUsage,
  ConversationRecord,
} from "@nervekit/contracts";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { RuntimeState } from "../../../runtime/runtime-state.js";
import { deriveConversationTitle } from "../../conversations/operations/index.js";

export interface AppendEntryInput {
  id?: string;
  conversationId: string;
  agentId?: string;
  runId?: string;
  turnId?: string;
  liveMessageId?: string;
  messageOrdinal?: number;
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
  state: RuntimeState;
  appendEntry: AppendEntryFn;
  updateConversation: (conversation: ConversationRecord) => Promise<void>;
  events: EventBus;
}

/**
 * Live coordinates of an ended assistant message awaiting materialization.
 * Assistant messages end and mirror strictly in order, so consuming these
 * FIFO assigns each mirrored assistant entry its own message — even when a
 * batch contains several assistant entries or the entry surfaces during a
 * later (non-assistant) `message_end`.
 */
export interface AssistantMessageMeta {
  turnId: string;
  liveMessageId: string;
  messageOrdinal: number;
}

/** Tracks the streaming assistant message and queues its coordinates FIFO. */
export class AssistantEntryMetaQueue {
  readonly queue: AssistantMessageMeta[] = [];
  private current: AssistantMessageMeta | undefined;

  onMessageStarted(meta: AssistantMessageMeta): void {
    this.current = {
      turnId: meta.turnId,
      liveMessageId: meta.liveMessageId,
      messageOrdinal: meta.messageOrdinal,
    };
  }

  onMessageEnded(role: string): void {
    if (role !== "assistant" || !this.current) return;
    this.queue.push(this.current);
    this.current = undefined;
  }
}

export class MessageMirror {
  constructor(private readonly deps: MessageMirrorDeps) {}

  async mirrorNewHarnessEntries(
    agent: AgentRecord,
    storage: JsonlConversationStorage,
    knownEntryIds: Set<string>,
    metadata: {
      runId?: string;
      turnId?: string;
      /** FIFO of ended-but-unmaterialized assistant messages; consumed here. */
      assistantMessageMeta?: AssistantMessageMeta[];
    } = {},
  ): Promise<ConversationEntry[]> {
    const mirrored: ConversationEntry[] = [];
    const storageEntries = await storage.getEntries();
    const visibleEntryIds = new Set(
      this.deps.state
        .getConversationEntries(agent.conversationId)
        .map((entry) => entry.id),
    );
    for (const entry of storageEntries) {
      if (knownEntryIds.has(entry.id)) continue;
      knownEntryIds.add(entry.id);
      if (entry.type !== "message") continue;
      if (
        entry.message.role !== "user" &&
        entry.message.role !== "assistant" &&
        entry.message.role !== "toolResult" &&
        entry.message.role !== "harness"
      ) {
        continue;
      }
      const role: ConversationEntry["role"] =
        entry.message.role === "toolResult" || entry.message.role === "harness"
          ? "system"
          : entry.message.role;
      const messageMeta =
        role === "assistant"
          ? metadata.assistantMessageMeta?.shift()
          : undefined;
      const uiEntry = await this.deps.appendEntry(
        {
          id: entry.id,
          conversationId: agent.conversationId,
          agentId: agent.id,
          runId: metadata.runId,
          turnId: messageMeta?.turnId ?? metadata.turnId,
          liveMessageId: messageMeta?.liveMessageId,
          messageOrdinal: messageMeta?.messageOrdinal,
          parentEntryId: resolveVisibleParentId(
            entry.parentId,
            storageEntries,
            visibleEntryIds,
          ),
          role,
          kind: entryKind(entry.message as AgentMessage),
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
    const conversation = this.deps.state.conversations.get(conversationId);
    if (!conversation) return;
    const userEntryCount = this.deps.state
      .getConversationEntries(conversation.id)
      .filter((entry) => entry.role === "user").length;
    if (userEntryCount !== 1) return;
    const title = deriveConversationTitle(text);
    if (!title || title === conversation.title) return;
    await this.deps.updateConversation({
      ...conversation,
      title,
      updatedAt: new Date().toISOString(),
    });
    await this.deps.events.publish("conversation.updated", {
      conversation: this.deps.state.conversations.get(conversation.id),
    });
  }
}

/**
 * Drop mirrored assistant entries' live messages from future active-run
 * snapshots. Once the entry is durable, a snapshot refresh must not
 * resurrect the live copy at the bottom of the transcript.
 */
export function markMirroredEntriesMaterialized(
  runtime: {
    markMessageMaterialized(
      runId: string,
      turnId: string,
      liveMessageId: string,
    ): void;
  },
  runId: string,
  entries: ConversationEntry[],
): void {
  for (const entry of entries) {
    if (entry.role === "assistant" && entry.turnId && entry.liveMessageId) {
      runtime.markMessageMaterialized(runId, entry.turnId, entry.liveMessageId);
    }
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
      status: message.isError ? "error" : "completed",
      isError: message.isError,
      toolRecordId: toolRecordIdFromDetails(message.details),
      outputOmitted: message.isError ? undefined : true,
    };
  }
  if (message.role === "harness") {
    return {
      type: message.eventType,
      source: "harness",
      ...(message.details && typeof message.details === "object"
        ? (message.details as Record<string, unknown>)
        : { details: message.details }),
    };
  }
  if (message.role !== "assistant") return undefined;
  const thinkingBlocks = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => ({ text: part.thinking, redacted: part.redacted }))
    .filter((part) => part.text.length > 0 || part.redacted === true);
  const details: Record<string, unknown> = {};
  if (thinkingBlocks.length > 0) details.thinkingBlocks = thinkingBlocks;
  if (message.stopReason === "aborted" || message.stopReason === "error") {
    details.stopReason = message.stopReason;
    details.errorMessage = message.errorMessage;
  }
  return Object.keys(details).length > 0 ? details : undefined;
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

function entryKind(message: AgentMessage): ConversationEntry["kind"] {
  if (message.role === "harness" && message.eventType === "task_event") {
    return "task_event";
  }
  return "message";
}

export function agentMessageText(message: AgentMessage): string {
  if (message.role === "harness") return message.content;
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
    if (!message.isError) return `[Tool result: ${message.toolName}]`;
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const preview = text.slice(0, 2_048);
    return preview || `[Tool error: ${message.toolName}]`;
  }
  return "";
}
