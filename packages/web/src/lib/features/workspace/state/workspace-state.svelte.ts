import type {
  AgentRecord,
  ApprovalWithToolCall,
  ClientConfig,
  ConversationRecord,
  PlanReviewRecord,
  ProjectRecord,
  StatusResponse,
  UserQuestionRecord,
} from "$lib/api";

export type CenterTabIdentity =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string }
  | { kind: "task"; id: string }
  | { kind: "file"; id: string }
  | { kind: "pr"; id: string }
  | { kind: "settings"; id: "settings" }
  | { kind: "logs"; id: "logs" };

export const workspaceState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  lastEventSeq: 0,
  error: undefined as string | undefined,
  projects: [] as ProjectRecord[],
  conversations: [] as ConversationRecord[],
  agents: [] as AgentRecord[],
  approvals: [] as ApprovalWithToolCall[],
  userQuestions: [] as UserQuestionRecord[],
  planReviews: [] as PlanReviewRecord[],
  openCenterTabs: [] as CenterTabIdentity[],
  activeCenterTab: undefined as CenterTabIdentity | undefined,
  projectPickerOpen: false,
});
