import { createHash } from "node:crypto";
import {
  type ConversationEntry,
  type ConversationSnapshot,
  type ConversationTree,
  conversationSnapshotSchema,
  type ToolCallTranscriptRecord,
  toolCallTranscriptRecordSchema,
} from "@nervekit/shared";
import type { StoredSandboxEvent } from "../state/event-store.js";

/**
 * Rebuilds a read-only {@link ConversationSnapshot} from the manager's durable
 * sandbox event log. This is the transport-neutral fallback used when the
 * sandbox controller session is disconnected (or unresponsive) and the daemon
 * cannot serve `sandbox.conversation.snapshot.get` directly. The durable log
 * carries enough state (`run.transcript.appended` / `conversation.entry.appended`
 * for entries, `conversation.tool_call.updated` for tool calls) to render the
 * transcript without contacting the container.
 */
export function projectConversationSnapshotFromEvents(input: {
  sandboxId: string;
  events: StoredSandboxEvent[];
  conversationId?: string;
  agentId?: string;
  runId?: string;
}): ConversationSnapshot | undefined {
  const projectId = sandboxProjectId(input.sandboxId);
  const selection = collectEntries(input.events, projectId, input);
  const conversationId =
    input.conversationId ?? selection.at(-1)?.entry.conversationId;
  if (!conversationId) return undefined;

  const collected = collectEntries(input.events, projectId, {
    agentId: input.agentId,
  });
  const entries = orderEntries(
    collected
      .filter((item) => item.entry.conversationId === conversationId)
      .map((item) => item.entry),
  );
  if (entries.length === 0) return undefined;

  const toolCalls = collectToolCalls(input.events, conversationId, {
    agentId: input.agentId,
  });
  const activeEntryId = entries.at(-1)?.id;
  const createdAt = entries[0]?.createdAt ?? new Date().toISOString();
  const updatedAt = entries.at(-1)?.createdAt ?? createdAt;
  const activeAgentId = input.agentId ?? entries.at(-1)?.agentId;
  const lastEventSeq = input.events.at(-1)?.seq ?? 0;

  return conversationSnapshotSchema.parse({
    conversation: {
      id: conversationId,
      projectId,
      title: titleFor(entries, conversationId),
      mode: "coding",
      permissionLevel: "autonomous",
      approvalPolicy: { autoApproveReadOnly: true },
      activeAgentId,
      activeEntryId,
      createdAt,
      updatedAt,
      lastUserMessageAt: entries.filter((entry) => entry.role === "user").at(-1)
        ?.createdAt,
    },
    entries,
    activeEntryIds: activeEntryId ? [activeEntryId] : [],
    tree: linearTree(conversationId, entries, activeEntryId),
    toolCalls,
    activeRun: undefined,
    contextUsage: undefined,
    cursorSeq: lastEventSeq,
    generatedAt: new Date().toISOString(),
  });
}

type CollectedEntry = { seq: number; entry: ConversationEntry };

function collectEntries(
  events: StoredSandboxEvent[],
  projectId: string,
  filter: { agentId?: string; runId?: string },
): CollectedEntry[] {
  const out: CollectedEntry[] = [];
  for (const event of events) {
    if (event.durability === "transient") continue;
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const entry =
      event.type === "conversation.entry.appended"
        ? entryFromConversationEvent(payload)
        : event.type === "run.transcript.appended"
          ? entryFromTranscriptEvent(payload, projectId)
          : undefined;
    if (!entry) continue;
    if (filter.agentId && entry.agentId && entry.agentId !== filter.agentId)
      continue;
    if (filter.runId && entry.runId && entry.runId !== filter.runId) continue;
    out.push({ seq: event.seq ?? 0, entry });
  }
  return out;
}

function entryFromConversationEvent(
  payload: Record<string, unknown>,
): ConversationEntry | undefined {
  const parsed = conversationEntryFrom(payload.entry);
  return parsed;
}

function entryFromTranscriptEvent(
  payload: Record<string, unknown>,
  _projectId: string,
): ConversationEntry | undefined {
  const role = payload.role;
  if (role !== "user" && role !== "assistant" && role !== "system")
    return undefined;
  const conversationId =
    typeof payload.conversationId === "string"
      ? payload.conversationId
      : undefined;
  if (!conversationId) return undefined;
  const entryId =
    typeof payload.entryId === "string" ? payload.entryId : undefined;
  const content = asRecord(payload.content);
  return {
    id: normalizeEntryId(entryId),
    conversationId,
    agentId: typeof payload.agentId === "string" ? payload.agentId : undefined,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    turnId: typeof payload.turnId === "string" ? payload.turnId : undefined,
    liveMessageId:
      typeof payload.liveMessageId === "string"
        ? payload.liveMessageId
        : undefined,
    role,
    kind: "message",
    text: typeof content?.text === "string" ? content.text : "",
    details: payload.details,
    createdAt:
      typeof payload.createdAt === "string"
        ? payload.createdAt
        : new Date().toISOString(),
  };
}

function conversationEntryFrom(value: unknown): ConversationEntry | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const role = record.role;
  if (role !== "user" && role !== "assistant" && role !== "system")
    return undefined;
  const conversationId =
    typeof record.conversationId === "string"
      ? record.conversationId
      : undefined;
  if (!conversationId) return undefined;
  return {
    id: normalizeEntryId(typeof record.id === "string" ? record.id : undefined),
    conversationId,
    agentId: typeof record.agentId === "string" ? record.agentId : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    turnId: typeof record.turnId === "string" ? record.turnId : undefined,
    liveMessageId:
      typeof record.liveMessageId === "string"
        ? record.liveMessageId
        : undefined,
    role,
    kind: "message",
    text: typeof record.text === "string" ? record.text : "",
    details: record.details,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
}

function collectToolCalls(
  events: StoredSandboxEvent[],
  conversationId: string,
  filter: { agentId?: string; runId?: string },
): ToolCallTranscriptRecord[] {
  const latest = new Map<string, ToolCallTranscriptRecord>();
  for (const event of events) {
    if (event.type !== "conversation.tool_call.updated") continue;
    const payload = asRecord(event.payload);
    const parsed = toolCallTranscriptRecordSchema.safeParse(payload?.toolCall);
    if (!parsed.success) continue;
    const record = parsed.data;
    if (record.conversationId !== conversationId) continue;
    if (filter.agentId && record.agentId !== filter.agentId) continue;
    if (filter.runId && record.runId !== filter.runId) continue;
    latest.set(record.id, record);
  }
  return [...latest.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-100);
}

function orderEntries(entries: ConversationEntry[]): ConversationEntry[] {
  return entries
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-200)
    .map((entry, index, all) => ({
      ...entry,
      parentEntryId: index > 0 ? all[index - 1]?.id : undefined,
    }));
}

function linearTree(
  conversationId: string,
  entries: ConversationEntry[],
  activeEntryId?: string,
): ConversationTree {
  return {
    conversationId,
    activeEntryId,
    rootEntryIds: entries[0] ? [entries[0].id] : [],
    nodes: entries.map((entry, index) => ({
      entry,
      childEntryIds: entries[index + 1] ? [entries[index + 1].id] : [],
    })),
  };
}

function titleFor(
  entries: ConversationEntry[],
  conversationId: string,
): string {
  const firstUser = entries.find((entry) => entry.role === "user")?.text.trim();
  return firstUser
    ? firstUser.slice(0, 80)
    : `Sandbox conversation ${conversationId}`;
}

function normalizeEntryId(entryId: string | undefined): string {
  if (entryId?.startsWith("entry_")) return entryId;
  return `entry_${entryId ?? Date.now()}`;
}

function sandboxProjectId(sandboxId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(sandboxId))
    .digest("hex");
  return `proj_sandbox_${digest.slice(0, 16)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
