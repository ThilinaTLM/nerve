import type {
  AgentActivitySnapshot,
  ConversationActivitySnapshot,
} from "@nervekit/contracts/agents";
import type { AgentRecord } from "@nervekit/contracts/agents";
import {
  agentRunningTone,
  type StatusTone,
} from "@nervekit/ui-kit/display/status";
import { conversationViewKey } from "$lib/domain/navigation/view-keys";

export type ConversationLiveActivity = {
  transient?: { compaction?: { state: string } };
  sending?: boolean;
};

export type ConversationActivitySource = "server" | "local-overlay" | "none";

export type ConversationActivityIndicator =
  | "idle"
  | "running"
  | "needs-user"
  | "awaiting-async"
  | "error"
  | "aborted"
  | "completed";

export type ConversationActivityState = {
  indicator: ConversationActivityIndicator;
  tone: StatusTone;
  pulse: boolean;
  label?: string;
  busy: boolean;
  needsUser: boolean;
  source: ConversationActivitySource;
  clearableFailure?: boolean;
};

export const idleConversationActivity: ConversationActivityState = {
  indicator: "idle",
  tone: "neutral",
  pulse: false,
  label: "Idle",
  busy: false,
  needsUser: false,
  source: "none",
  clearableFailure: false,
};

type ActivitySnapshot = AgentActivitySnapshot | ConversationActivitySnapshot;
type AgentMode = AgentRecord["mode"];

/** Maps the server-owned activity projection to product presentation. */
export function activityForSnapshot(
  snapshot: ActivitySnapshot | undefined,
  mode: AgentMode = "coding",
  view?: ConversationLiveActivity,
): ConversationActivityState {
  const state = snapshot?.state ?? "idle";

  // Unsaved work exists only between the local action and its canonical event.
  // It may overlay settled server states, but never hides canonical attention.
  if (
    (view?.sending || view?.transient?.compaction?.state === "running") &&
    (state === "idle" || state === "completed" || state === "aborted")
  ) {
    const compacting = view?.transient?.compaction?.state === "running";
    return {
      indicator: "running",
      tone: compacting ? "info" : agentRunningTone(mode),
      pulse: true,
      label: compacting ? "Compacting context" : "Agent starting",
      busy: true,
      needsUser: false,
      source: "local-overlay",
      clearableFailure: false,
    };
  }

  switch (state) {
    case "running":
      return {
        indicator: "running",
        tone: agentRunningTone(mode),
        pulse: true,
        label: "Agent running",
        busy: true,
        needsUser: false,
        source: "server",
        clearableFailure: false,
      };
    case "awaiting_user":
      return {
        indicator: "needs-user",
        tone: "warning",
        pulse: false,
        label: "Needs user action",
        busy: false,
        needsUser: true,
        source: "server",
        clearableFailure: false,
      };
    case "awaiting_async":
      return {
        indicator: "awaiting-async",
        tone: "warning",
        pulse: false,
        label: "Waiting for background work",
        busy: false,
        needsUser: false,
        source: "server",
        clearableFailure: false,
      };
    case "error":
      return {
        indicator: "error",
        tone: "destructive",
        pulse: false,
        label: "Agent error",
        busy: false,
        needsUser: false,
        source: "server",
        clearableFailure: true,
      };
    case "aborted":
      return {
        indicator: "aborted",
        tone: "neutral",
        pulse: false,
        label: "Stopped",
        busy: false,
        needsUser: false,
        source: "server",
        clearableFailure: false,
      };
    case "completed":
      return {
        indicator: "completed",
        tone: "neutral",
        pulse: false,
        label: "Completed",
        busy: false,
        needsUser: false,
        source: "server",
        clearableFailure: false,
      };
    default:
      return snapshot
        ? { ...idleConversationActivity, source: "server" }
        : idleConversationActivity;
  }
}

export function buildConversationActivityById(input: {
  conversations: readonly {
    id: string;
    mode: AgentMode;
    activeAgentId?: string;
  }[];
  agents: readonly Pick<AgentRecord, "id" | "conversationId" | "mode">[];
  activities: Readonly<Record<string, ConversationActivitySnapshot>>;
  views: Readonly<Record<string, ConversationLiveActivity>>;
}): Record<string, ConversationActivityState> {
  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]));
  return Object.fromEntries(
    input.conversations.map((conversation) => {
      const agent = conversation.activeAgentId
        ? agentsById.get(conversation.activeAgentId)
        : undefined;
      // Conversation mode is a default; mode changes belong to the active agent.
      const mode =
        agent?.conversationId === conversation.id
          ? agent.mode
          : conversation.mode;
      return [
        conversation.id,
        activityForSnapshot(
          input.activities[conversation.id],
          mode,
          input.views[conversationViewKey(conversation.id)],
        ),
      ];
    }),
  );
}
