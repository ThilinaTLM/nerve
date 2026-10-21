import type {
  ConversationConfig,
  ConversationSummary,
  Project,
} from "@nervekit/contracts/core";

/** Presentation-only shapes for the original project navigation views. */
export type ProjectRecord = Project & { dir: string };
export type ConversationRecord = ConversationSummary & {
  pinned: boolean;
  activeAgentId: string;
  permissionRuleSetId: string;
};
export type AgentRecord = {
  id: string;
  conversationId: string;
  agentProfile: ConversationConfig["agentProfile"];
  model?: ConversationConfig["model"];
  permissionRuleSetId?: string;
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
