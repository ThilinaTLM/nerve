import type {
  AgentActivitySnapshot,
  AgentRecord,
  ConversationActivitySnapshot,
  ConversationEntry,
  ConversationRecord,
  EventEnvelope,
  ToolCallTranscriptRecord,
} from "$lib/api";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { upsertAgentByUpdatedAt } from "./agent-freshness";
import { freshestActivity } from "./activity-freshness";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isAgentRecord(value: unknown): value is AgentRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.updatedAt === "string",
  );
}

function isConversationRecord(value: unknown): value is ConversationRecord {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.updatedAt === "string",
  );
}

function isConversationEntry(value: unknown): value is ConversationEntry {
  const candidate = recordValue(value);
  return Boolean(
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.conversationId === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.createdAt === "string",
  );
}

function isToolCallRecord(value: unknown): value is ToolCallTranscriptRecord {
  const candidate = recordValue(value);
  return Boolean(candidate && typeof candidate.id === "string");
}

export function upsertConversationRecord(
  conversation: ConversationRecord,
): void {
  const index = workspaceState.conversations.findIndex(
    (candidate) => candidate.id === conversation.id,
  );
  workspaceState.conversations =
    index === -1
      ? [conversation, ...workspaceState.conversations]
      : workspaceState.conversations.map((candidate) =>
          candidate.id === conversation.id ? conversation : candidate,
        );
}

export function removeConversationRecord(conversationId: string): void {
  workspaceState.conversations = workspaceState.conversations.filter(
    (conversation) => conversation.id !== conversationId,
  );
  workspaceState.conversationActivities = Object.fromEntries(
    Object.entries(workspaceState.conversationActivities).filter(
      ([id]) => id !== conversationId,
    ),
  );
  workspaceState.agentActivities = Object.fromEntries(
    Object.entries(workspaceState.agentActivities).filter(
      ([, activity]) => activity.conversationId !== conversationId,
    ),
  );
}

export function patchConversationForEntry(entry: ConversationEntry): void {
  const index = workspaceState.conversations.findIndex(
    (candidate) => candidate.id === entry.conversationId,
  );
  if (index === -1) return;
  const current = workspaceState.conversations[index];
  if (!current) return;
  const lastUserMessageAt =
    entry.role === "user" &&
    (!current.lastUserMessageAt || entry.createdAt > current.lastUserMessageAt)
      ? entry.createdAt
      : current.lastUserMessageAt;
  workspaceState.conversations = workspaceState.conversations.map((candidate) =>
    candidate.id === entry.conversationId
      ? {
          ...candidate,
          activeEntryId: entry.id,
          updatedAt: entry.createdAt,
          lastUserMessageAt,
        }
      : candidate,
  );
}

export function upsertAgentRecordFresh(agent: AgentRecord): void {
  workspaceState.agents = upsertAgentByUpdatedAt(agent, workspaceState.agents);
}

export function upsertAgentActivity(activity: AgentActivitySnapshot): void {
  const current = workspaceState.agentActivities[activity.agentId];
  const freshest = freshestActivity(current, activity);
  if (freshest === current) return;
  workspaceState.agentActivities = {
    ...workspaceState.agentActivities,
    [activity.agentId]: freshest,
  };
}

export function upsertConversationActivity(
  activity: ConversationActivitySnapshot,
): void {
  const current =
    workspaceState.conversationActivities[activity.conversationId];
  const freshest = freshestActivity(current, activity);
  if (freshest === current) return;
  workspaceState.conversationActivities = {
    ...workspaceState.conversationActivities,
    [activity.conversationId]: freshest,
  };
}

export function upsertPendingToolCall(
  toolCall: ToolCallTranscriptRecord,
): void {
  const pending =
    toolCall.status === "waiting" &&
    toolCall.interactions.some(
      (interaction) => interaction.status === "pending",
    );
  const index = workspaceState.pendingToolCalls.findIndex(
    (candidate) => candidate.id === toolCall.id,
  );
  if (!pending) {
    if (index !== -1)
      workspaceState.pendingToolCalls = workspaceState.pendingToolCalls.filter(
        (candidate) => candidate.id !== toolCall.id,
      );
    return;
  }
  const current =
    index === -1 ? undefined : workspaceState.pendingToolCalls[index];
  if (current && current.revision >= toolCall.revision) return;
  workspaceState.pendingToolCalls =
    index === -1
      ? [toolCall, ...workspaceState.pendingToolCalls]
      : workspaceState.pendingToolCalls.map((candidate) =>
          candidate.id === toolCall.id ? toolCall : candidate,
        );
}

export function applyEntityEvent(
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const data = event.data ?? {};
  const agent = recordValue(data.agent);
  const conversation = recordValue(data.conversation);
  const entry = recordValue(data.entry);
  const toolCall = recordValue(data.toolCall);
  const activity = recordValue(data.activity);

  if (isConversationRecord(conversation))
    upsertConversationRecord(conversation);
  if (
    event.type === "conversation.entry.appended" &&
    isConversationEntry(entry)
  )
    patchConversationForEntry(entry);
  if (event.type === "conversation.deleted") {
    const conversationId =
      stringValue(data.conversationId) ?? stringValue(data.id);
    if (conversationId) removeConversationRecord(conversationId);
  }

  if (isAgentRecord(agent)) upsertAgentRecordFresh(agent);

  if (isToolCallRecord(toolCall)) upsertPendingToolCall(toolCall);

  if (
    event.type === "agent.activity_changed" &&
    activity &&
    typeof activity.agentId === "string" &&
    typeof activity.conversationId === "string" &&
    typeof activity.state === "string" &&
    typeof activity.updatedAt === "string"
  ) {
    upsertAgentActivity(activity as AgentActivitySnapshot);
  }
  if (
    event.type === "conversation.activity_changed" &&
    activity &&
    typeof activity.conversationId === "string" &&
    typeof activity.state === "string" &&
    typeof activity.updatedAt === "string"
  ) {
    upsertConversationActivity(activity as ConversationActivitySnapshot);
  }
}
