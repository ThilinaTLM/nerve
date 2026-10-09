import type {
  ConversationConfig,
  ConversationSummary,
  Project,
} from "@nervekit/contracts/core";
import type { StatusTone } from "@nervekit/ui-kit/display/status";

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
  mode: ConversationConfig["mode"];
  model?: ConversationConfig["model"];
  permissionRuleSetId?: string;
};
export type ConversationActivityState = {
  indicator:
    | "idle"
    | "running"
    | "needs-user"
    | "awaiting-async"
    | "error"
    | "aborted"
    | "completed";
  tone: StatusTone;
  pulse: boolean;
  label?: string;
  busy: boolean;
  needsUser: boolean;
  source: "server" | "local-overlay" | "none";
  clearableFailure?: boolean;
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
