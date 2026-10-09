import type {
  ConversationEvent,
  ConversationSnapshot,
  ConversationSummary,
  Project,
} from "@nervekit/contracts/core";
import type { ModelInfo } from "@nervekit/contracts/models";
import type {
  AgentRecord,
  AgentActivitySnapshot,
  ConversationRecord,
  ProjectRecord,
} from "$lib/presentation/view-models/conversation";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";
import { eventEntry } from "./core-transcript.adapter";

export function projectView(project: Project): ProjectRecord {
  return { ...project, dir: project.directory };
}
export function conversationView(
  snapshot: ConversationSnapshot,
): ConversationRecord {
  const c = snapshot.conversation;
  return {
    ...c,
    mode: snapshot.config.mode,
    activeAgentId: c.id,
    activeEntryId: c.headEventId ?? undefined,
    pinned: !!c.pinnedAt,
    completedAt: c.completedAt ?? undefined,
    lastUserMessageAt: c.lastUserMessageAt ?? undefined,
    runtimeStatusClearedAt: c.statusClearedAt ?? undefined,
  };
}
export function agentView(
  snapshot: ConversationSnapshot,
  child?: ConversationSummary,
  events: readonly ConversationEvent[] = [],
  childSnapshot?: ConversationSnapshot,
): AgentRecord {
  const c = child ?? snapshot.conversation;
  const config = childSnapshot?.config ?? snapshot.config;
  const origin = child?.parentToolCallId
    ? (snapshot.toolCalls.find((call) => call.id === child.parentToolCallId)
        ?.toolName ??
      events.find(
        (e) =>
          e.type === "tool_call_response" &&
          e.payload.toolCallId === child.parentToolCallId,
      ))
    : undefined;
  const toolName =
    typeof origin === "string"
      ? origin
      : origin?.type === "tool_call_response"
        ? origin.payload.toolName
        : undefined;
  return {
    id: c.id,
    conversationId: c.id,
    projectId: c.projectId,
    projectDir: config.workingDirectory,
    parentAgentId: child ? snapshot.conversation.id : undefined,
    rootAgentId: snapshot.conversation.id,
    name: child?.title,
    executionKind: child
      ? toolName === "explore"
        ? "explore"
        : toolName?.startsWith("subagent_")
          ? "async_developer"
          : undefined
      : "root",
    mode: child?.mode ?? config.mode,
    permissionRuleSetId:
      child?.permissionRuleSetId ?? config.permissionRuleSetId,
    model: child?.model ?? config.model,
    thinkingLevel: child && !childSnapshot ? "off" : config.reasoningLevel,
    systemPrompt:
      child && !childSnapshot ? undefined : (config.systemPrompt ?? undefined),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
export function conversationContext(
  snapshot: ConversationSnapshot,
  events: readonly ConversationEvent[],
  models: readonly ModelInfo[] = [],
  childSnapshots: Readonly<Record<string, ConversationSnapshot>> = {},
) {
  const boundary = events.findLast(
    (e) => e.type === "assistant_message" || e.type === "compaction",
  );
  const response =
    boundary?.type === "assistant_message" ? boundary.payload : undefined;
  const model = models.find(
    (m) =>
      m.provider === (response?.provider ?? snapshot.config.model.provider) &&
      m.modelId === (response?.model ?? snapshot.config.model.modelId),
  );
  const contextWindow = model?.contextWindow ?? 0;
  const tokens = response
    ? response.usage.input +
      response.usage.cacheRead +
      response.usage.cacheWrite
    : null;
  const conversationAgents = [
    agentView(snapshot),
    ...snapshot.children.map((child) =>
      agentView(snapshot, child, events, childSnapshots[child.id]),
    ),
  ];
  const agentActivities: Record<string, AgentActivitySnapshot> = {};
  for (const c of [snapshot.conversation, ...snapshot.children])
    agentActivities[c.id] = {
      agentId: c.id,
      conversationId: c.id,
      state:
        c.status === "running"
          ? "running"
          : c.status === "waiting"
            ? "awaiting_user"
            : c.status === "failed"
              ? "error"
              : c.status === "interrupted"
                ? "aborted"
                : "idle",
      pendingInteractionCount:
        c.id === snapshot.conversation.id
          ? snapshot.toolCalls.filter(
              (call) => call.interaction && !call.interaction.resolution,
            ).length
          : 0,
      pendingAsyncCount:
        c.id === snapshot.conversation.id
          ? snapshot.children.filter((child) => child.status === "running")
              .length
          : 0,
      updatedAt: c.updatedAt,
    };
  return {
    activeConversation: conversationView(snapshot),
    activeAgent: conversationAgents[0],
    conversationAgents,
    agentActivities,
    conversationUsage: summarizeConversationUsage(events.map(eventEntry)),
    contextUsage: {
      tokens,
      contextWindow,
      percent:
        tokens !== null && contextWindow
          ? (tokens / contextWindow) * 100
          : null,
    },
    contextWindow,
  };
}
