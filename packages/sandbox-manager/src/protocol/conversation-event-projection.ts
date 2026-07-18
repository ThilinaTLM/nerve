import { createHash } from "node:crypto";
import {
  type ConversationEntry,
  type ConversationSnapshot,
  type ConversationTree,
  conversationSnapshotSchema,
  deriveConversationTitle,
  type ToolCallTranscriptRecord,
  toolCallTranscriptRecordSchema,
} from "@nervekit/contracts";
import type { StoredSandboxEvent } from "../state/event-store.js";

/**
 * Rebuilds a read-only {@link ConversationSnapshot} from the manager's
 * sequenced sandbox event log. This is the transport-neutral fallback used when the
 * sandbox controller session is disconnected (or unresponsive) and the daemon
 * cannot serve `sandbox.conversation.snapshot.get` directly. The stream log
 * carries enough state (`run.transcript.appended` / `conversation.entry.appended`
 * for entries, `toolCall.updated` for tool calls) to render the
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
  const selection = collectEntries(input.events, input);
  const conversationId =
    input.conversationId ?? selection.at(-1)?.entry.conversationId;
  if (!conversationId) return undefined;

  const collected = collectEntries(input.events, {
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
      mode: modeForConversation(input.events, conversationId),
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
  filter: { agentId?: string; runId?: string },
): CollectedEntry[] {
  const out: CollectedEntry[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const entry =
      event.type === "conversation.entry.appended"
        ? entryFromConversationEvent(payload)
        : event.type === "run.transcript.appended"
          ? entryFromTranscriptEvent(payload)
          : undefined;
    if (!entry) continue;
    if (filter.agentId && entry.agentId && entry.agentId !== filter.agentId)
      continue;
    if (filter.runId && entry.runId && entry.runId !== filter.runId) continue;
    out.push({ seq: event.seq, entry });
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
    if (event.type !== "toolCall.updated") continue;
    const payload = asRecord(event.payload);
    const parsed = toolCallTranscriptRecordSchema.safeParse(payload?.toolCall);
    if (!parsed.success) continue;
    const record = parsed.data;
    if (record.conversationId !== conversationId) continue;
    if (filter.agentId && record.agentId !== filter.agentId) continue;
    if (filter.runId && record.runId !== filter.runId) continue;
    const current = latest.get(record.id);
    latest.set(
      record.id,
      current ? mergeToolCallTranscriptRecord(current, record) : record,
    );
  }
  return [...latest.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-100);
}

function mergeToolCallTranscriptRecord(
  current: ToolCallTranscriptRecord,
  next: ToolCallTranscriptRecord,
): ToolCallTranscriptRecord {
  return {
    ...current,
    ...next,
    argsPreview:
      next.argsPreview === undefined ? current.argsPreview : next.argsPreview,
    resultPreview:
      next.resultPreview === undefined
        ? current.resultPreview
        : next.resultPreview,
    previewOverflow:
      next.previewOverflow === undefined
        ? current.previewOverflow
        : next.previewOverflow,
    turnId: next.turnId === undefined ? current.turnId : next.turnId,
    liveMessageId:
      next.liveMessageId === undefined
        ? current.liveMessageId
        : next.liveMessageId,
    contentIndex:
      next.contentIndex === undefined
        ? current.contentIndex
        : next.contentIndex,
  };
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
    ? deriveConversationTitle(firstUser)
    : `Sandbox conversation ${conversationId}`;
}

function modeForConversation(
  events: StoredSandboxEvent[],
  conversationId: string,
): "coding" | "planning" {
  for (const event of events) {
    if (event.type !== "run.started") continue;
    const payload = asRecord(event.payload);
    if (stringField(payload ?? {}, "conversationId") !== conversationId)
      continue;
    const mode = modeField(payload ?? {});
    if (mode) return mode;
  }
  return "coding";
}

function normalizeEntryId(entryId: string | undefined): string {
  if (entryId?.startsWith("entry_")) return entryId;
  return `entry_${entryId ?? Date.now()}`;
}

export function projectSandboxSummariesFromEvents(input: {
  sandboxId: string;
  events: StoredSandboxEvent[];
}): {
  conversations: Array<{
    conversationId: string;
    agentIds: string[];
    title?: string;
    mode?: "coding" | "planning";
    createdAt?: string;
    updatedAt?: string;
    activeRunIds?: string[];
  }>;
  agents: Array<{
    conversationId: string;
    agentId: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  runs: Array<{
    conversationId: string;
    agentId: string;
    runId: string;
    status: string;
    promptSummary?: string;
    createdAt?: string;
    updatedAt?: string;
    terminalAt?: string;
  }>;
} {
  const conversations = new Map<
    string,
    {
      conversationId: string;
      agentIds: Set<string>;
      title?: string;
      mode?: "coding" | "planning";
      createdAt?: string;
      updatedAt?: string;
      activeRunIds: Set<string>;
    }
  >();
  const agents = new Map<
    string,
    {
      conversationId: string;
      agentId: string;
      createdAt?: string;
      updatedAt?: string;
    }
  >();
  const runs = new Map<
    string,
    {
      conversationId: string;
      agentId: string;
      runId: string;
      status: string;
      promptSummary?: string;
      createdAt?: string;
      updatedAt?: string;
      terminalAt?: string;
    }
  >();

  for (const event of input.events) {
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const entry = asRecord(payload.entry);
    const conversationId =
      stringField(payload, "conversationId") ??
      (entry ? stringField(entry, "conversationId") : undefined);
    const agentId =
      stringField(payload, "agentId") ??
      (entry ? stringField(entry, "agentId") : undefined);
    const runId =
      stringField(payload, "runId") ??
      (entry ? stringField(entry, "runId") : undefined);
    if (!conversationId) continue;
    const ts = event.ts;
    const conversation = ensureSummaryConversation(
      conversations,
      conversationId,
      ts,
    );
    if (agentId) {
      conversation.agentIds.add(agentId);
      const key = `${conversationId}/${agentId}`;
      const agent = agents.get(key) ?? {
        conversationId,
        agentId,
        createdAt: ts,
      };
      agent.updatedAt = ts;
      agents.set(key, agent);
    }

    if (event.type === "run.started" && runId && agentId) {
      const run = runs.get(runId) ?? {
        conversationId,
        agentId,
        runId,
        status: "running",
        createdAt: ts,
      };
      run.status = "running";
      run.updatedAt = ts;
      run.promptSummary =
        stringField(payload, "promptSummary") ?? run.promptSummary;
      conversation.mode = modeField(payload) ?? conversation.mode ?? "coding";
      if (!conversation.title && run.promptSummary) {
        const title = deriveConversationTitle(run.promptSummary);
        if (title !== "New Conversation") conversation.title = title;
      }
      runs.set(runId, run);
      conversation.activeRunIds.add(runId);
    } else if (event.type === "run.waiting" && runId && agentId) {
      const run = runs.get(runId) ?? {
        conversationId,
        agentId,
        runId,
        status: "running",
        createdAt: ts,
      };
      run.status =
        stringField(payload, "waitKind") === "approval"
          ? "waiting_for_approval"
          : "waiting_for_input";
      run.updatedAt = ts;
      runs.set(runId, run);
      conversation.activeRunIds.add(runId);
    } else if (
      (event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled") &&
      runId &&
      agentId
    ) {
      const run = runs.get(runId) ?? {
        conversationId,
        agentId,
        runId,
        status: "running",
        createdAt: ts,
      };
      run.status = event.type.slice("run.".length);
      run.updatedAt = ts;
      run.terminalAt = ts;
      runs.set(runId, run);
      conversation.activeRunIds.delete(runId);
    } else if (event.type === "run.transcript.appended") {
      if (payload.role === "user" && !conversation.title) {
        const text = textOf(payload.content).trim();
        if (text) conversation.title = deriveConversationTitle(text);
      }
    } else if (event.type === "conversation.entry.appended") {
      if (entry?.role === "user" && !conversation.title) {
        const text = typeof entry.text === "string" ? entry.text.trim() : "";
        if (text) conversation.title = deriveConversationTitle(text);
      }
    }
    if (!conversation.createdAt || ts < conversation.createdAt)
      conversation.createdAt = ts;
    if (!conversation.updatedAt || ts > conversation.updatedAt)
      conversation.updatedAt = ts;
  }

  return {
    conversations: [...conversations.values()].map((conversation) => ({
      conversationId: conversation.conversationId,
      agentIds: [...conversation.agentIds],
      title:
        conversation.title ??
        `Sandbox conversation ${conversation.conversationId}`,
      mode: conversation.mode,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      activeRunIds: [...conversation.activeRunIds],
    })),
    agents: [...agents.values()],
    runs: [...runs.values()],
  };
}

function ensureSummaryConversation(
  conversations: Map<
    string,
    {
      conversationId: string;
      agentIds: Set<string>;
      title?: string;
      mode?: "coding" | "planning";
      createdAt?: string;
      updatedAt?: string;
      activeRunIds: Set<string>;
    }
  >,
  conversationId: string,
  ts: string,
) {
  const current = conversations.get(conversationId);
  if (current) return current;
  const next = {
    conversationId,
    agentIds: new Set<string>(),
    title: undefined as string | undefined,
    mode: undefined as "coding" | "planning" | undefined,
    createdAt: ts,
    updatedAt: ts,
    activeRunIds: new Set<string>(),
  };
  conversations.set(conversationId, next);
  return next;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return typeof record?.text === "string" ? record.text : "";
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function modeField(
  record: Record<string, unknown>,
): "coding" | "planning" | undefined {
  return record.mode === "coding" || record.mode === "planning"
    ? record.mode
    : undefined;
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
