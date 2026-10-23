import type { ConversationSummary, Project } from "@nervekit/contracts/core";

/** Presentation-only shapes for the original project navigation views. */
export type ProjectRecord = Project & { dir: string };
export type ConversationRecord = ConversationSummary & {
  pinned: boolean;
  activeAgentId: string;
};
export type AgentRecord = Pick<
  ConversationSummary,
  "agentProfile" | "model" | "permissionRuleSetId"
> & {
  id: string;
  conversationId: string;
};
export type UpdateConversationStateRequest = {
  title?: string;
  pinned?: boolean;
  completed?: boolean;
  clearRuntimeStatus?: boolean;
};
export type PruneProjectConversationsRequest = {
  strategy: "olderThanDays" | "keepLatest" | "completed";
  olderThanDays?: number;
  keepLatest?: number;
};
