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
  | { kind: "auth"; id: "auth" }
  | { kind: "logs"; id: "logs" };

export const workspaceState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  receivedEventSeq: 0,
  processedEventSeq: 0,
  protocolSessionId: undefined as string | undefined,
  protocolFlowMode: "normal" as
    | "normal"
    | "catching_up"
    | "degraded"
    | "resync_required",
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
