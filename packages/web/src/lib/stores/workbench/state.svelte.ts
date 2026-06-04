import type {
  AgentRecord,
  ApprovalWithToolCall,
  AuthProviderMetadata,
  ClientConfig,
  CompletionItem,
  ModelInfo,
  PlanReviewRecord,
  ProcessLogQueryResponse,
  ProcessRecord,
  ProjectRecord,
  SessionEntry,
  SessionRecord,
  SessionTreeNode,
  Settings,
  StatusResponse,
  ToolCallRecord,
  UserQuestionRecord,
} from "../../api";

export type TranscriptItem = {
  id?: string;
  role: "user" | "assistant" | "system";
  kind?: SessionEntry["kind"];
  text: string;
  createdAt?: string;
  optimistic?: boolean;
  toolCallId?: string;
  toolRecordId?: string;
};

export type ConversationViewState = {
  sessionId: string;
  transcript: TranscriptItem[];
  toolCalls: ToolCallRecord[];
  treeNodes: SessionTreeNode[];
  streamingText: string;
  sending: boolean;
  error?: string;
  composerText: string;
  loading: boolean;
};

export type CenterTabIdentity =
  | { kind: "conversation"; id: string }
  | { kind: "process"; id: string };

export const workbenchState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  error: undefined as string | undefined,
  sending: false,
  projects: [] as ProjectRecord[],
  sessions: [] as SessionRecord[],
  agents: [] as AgentRecord[],
  treeNodes: [] as SessionTreeNode[],
  approvals: [] as ApprovalWithToolCall[],
  userQuestions: [] as UserQuestionRecord[],
  planReviews: [] as PlanReviewRecord[],
  processes: [] as ProcessRecord[],
  selectedProcessId: undefined as string | undefined,
  processLogs: undefined as ProcessLogQueryResponse | undefined,
  openConversationTabIds: [] as string[],
  openProcessTabIds: [] as string[],
  activeConversationTabId: undefined as string | undefined,
  activeCenterTab: undefined as CenterTabIdentity | undefined,
  conversationViews: {} as Record<string, ConversationViewState>,
  transcript: [] as TranscriptItem[],
  streamingText: "",
  slashCompletions: [] as CompletionItem[],
  models: [] as ModelInfo[],
  selectedModelKey: "nerve-faux:faux-fast",
  selectedThinkingLevel: "off" as AgentRecord["thinkingLevel"],
  selectedMode: "coding" as AgentRecord["mode"],
  selectedPermissionLevel: "autonomous" as AgentRecord["permissionLevel"],
  projectPickerOpen: false,
  settingsDraft: undefined as Settings | undefined,
  authProviders: [] as AuthProviderMetadata[],
  settingsMessage: undefined as string | undefined,
});
