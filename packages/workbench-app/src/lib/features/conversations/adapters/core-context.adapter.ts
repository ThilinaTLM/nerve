import type {
  TransferredConversationEvent,
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
import { deriveSubagentProfile, deriveSubagentTask } from "./subagent-profile";

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
function creatingToolCall(
  snapshot: ConversationSnapshot,
  events: readonly TransferredConversationEvent[],
  toolCallId: string,
): { toolName: string; arguments: unknown } | undefined {
  const open = snapshot.toolCalls.find((call) => call.id === toolCallId);
  if (open) return { toolName: open.toolName, arguments: open.arguments };
  for (const event of events)
    if (
      event.type === "tool_call_response" &&
      event.payload.toolCallId === toolCallId
    )
      return {
        toolName: event.payload.toolName,
        arguments: event.payload.arguments,
      };
  return undefined;
}
export function agentView(
  snapshot: ConversationSnapshot,
  child?: ConversationSummary,
  events: readonly TransferredConversationEvent[] = [],
): AgentRecord {
  const c = child ?? snapshot.conversation;
  const config = snapshot.config;
  const creatingCall = child?.parentToolCallId
    ? creatingToolCall(snapshot, events, child.parentToolCallId)
    : undefined;
  return {
    id: c.id,
    conversationId: c.id,
    projectId: c.projectId,
    projectDir: config.workingDirectory,
    parentAgentId: child ? snapshot.conversation.id : undefined,
    lastParentPromptAt: child?.lastParentPromptAt,
    name: child?.title,
    task: child
      ? deriveSubagentTask(child.title, [
          ...events.flatMap((event) =>
            event.type === "tool_call_response" &&
            event.payload.toolName === "subagent_prompt"
              ? [
                  {
                    toolName: event.payload.toolName,
                    arguments: event.payload.arguments,
                  },
                ]
              : [],
          ),
          ...snapshot.toolCalls
            .filter((call) => call.toolName === "subagent_prompt")
            .map((call) => ({
              toolName: call.toolName,
              arguments: call.arguments,
            })),
        ])
      : undefined,
    subagentProfile: child
      ? deriveSubagentProfile(child.title, creatingCall)
      : undefined,
    mode: child?.mode ?? config.mode,
    permissionRuleSetId:
      child?.permissionRuleSetId ?? config.permissionRuleSetId,
    model: child?.model ?? config.model,
    thinkingLevel: child ? undefined : config.reasoningLevel,
    systemPrompt: child ? undefined : (config.systemPrompt ?? undefined),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
export function conversationContext(
  snapshot: ConversationSnapshot,
  events: readonly TransferredConversationEvent[],
  models: readonly ModelInfo[] = [],
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
    ...snapshot.children.map((child) => agentView(snapshot, child, events)),
  ];
  const agentActivities: Record<string, AgentActivitySnapshot> = {};
  // Work the lead's turn ended with: running sub-agents and background commands.
  const pendingAsyncCount =
    snapshot.children.filter(
      (child) => child.status === "running" || child.status === "waiting",
    ).length + snapshot.asyncBash.filter((t) => t.status === "running").length;
  for (const c of [snapshot.conversation, ...snapshot.children]) {
    const lead = c.id === snapshot.conversation.id;
    const state: AgentActivitySnapshot["state"] =
      c.status === "running"
        ? "running"
        : c.status === "waiting"
          ? "awaiting_user"
          : c.status === "failed"
            ? "error"
            : c.status === "interrupted"
              ? "aborted"
              : lead && pendingAsyncCount > 0
                ? "awaiting_async"
                : "idle";
    agentActivities[c.id] = {
      agentId: c.id,
      conversationId: c.id,
      state,
      pendingInteractionCount: lead
        ? snapshot.toolCalls.filter(
            (call) => call.interaction && !call.interaction.resolution,
          ).length
        : 0,
      pendingAsyncCount: lead ? pendingAsyncCount : 0,
      updatedAt: c.updatedAt,
    };
  }
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
