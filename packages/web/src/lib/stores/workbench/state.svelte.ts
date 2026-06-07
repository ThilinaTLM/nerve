import type {
  AgentRecord,
  ApprovalWithToolCall,
  AuthProviderMetadata,
  ClientConfig,
  CompletionItem,
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationEntry,
  ConversationRecord,
  ConversationTreeNode,
  FilesystemFileResponse,
  ModelInfo,
  PlanReviewRecord,
  ProcessLogQueryResponse,
  ProcessRecord,
  ProjectRecord,
  Settings,
  StatusResponse,
  SubscriptionUsage,
  ToolCallRecord,
  UserQuestionRecord,
} from "../../api";
import type { FileDisplayMode } from "../../utils/file-display";

export type TranscriptDisplayKind = "message" | "thinking";

export type TranscriptItem = {
  id?: string;
  role: "user" | "assistant" | "system";
  kind?: ConversationEntry["kind"];
  displayKind?: TranscriptDisplayKind;
  text: string;
  createdAt?: string;
  optimistic?: boolean;
  live?: boolean;
  done?: boolean;
  redacted?: boolean;
  contentIndex?: number;
  toolCallId?: string;
  toolRecordId?: string;
  usage?: ConversationEntry["usage"];
};

export type LiveToolCallDraft = {
  kind: "tool_call_draft";
  key: string;
  runId?: string;
  conversationId: string;
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
  argsText: string;
  args?: Record<string, unknown>;
  done?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LiveToolOutputChunk = {
  stream: "stdout" | "stderr" | "combined";
  text: string;
  ts: string;
};

export type LiveToolOutput = {
  chunks: LiveToolOutputChunk[];
  text: string;
  updatedAt: string;
};

export type ConversationLiveState = {
  runId?: string;
  messages: TranscriptItem[];
  toolDrafts: LiveToolCallDraft[];
  toolOutputByToolCallId: Record<string, LiveToolOutput>;
};

export type ConversationViewState = {
  conversationId: string;
  transcript: TranscriptItem[];
  toolCalls: ToolCallRecord[];
  treeNodes: ConversationTreeNode[];
  streamingText: string;
  live: ConversationLiveState;
  activeRun?: ConversationActiveRunSnapshot;
  contextUsage?: ContextUsage;
  cursorSeq: number;
  sending: boolean;
  error?: string;
  composerText: string;
  loading: boolean;
};

export type PendingConversationState = {
  id: string;
  projectId: string;
  projectDir: string;
  title: "New Conversation";
  composerText: string;
  selectedModelKey: string;
  thinkingLevel: AgentRecord["thinkingLevel"];
  mode: AgentRecord["mode"];
  permissionLevel: AgentRecord["permissionLevel"];
  sending: boolean;
  error?: string;
  createdAt: string;
};

export type CenterTabIdentity =
  | { kind: "conversation"; id: string }
  | { kind: "pending-conversation"; id: string }
  | { kind: "process"; id: string }
  | { kind: "file"; id: string }
  | { kind: "settings"; id: "settings" };

export type FileViewState = {
  id: string;
  projectId: string;
  path: string;
  line?: number;
  content?: FilesystemFileResponse;
  displayMode?: FileDisplayMode;
  loading: boolean;
  error?: string;
};

export const workbenchState = $state({
  status: undefined as StatusResponse | undefined,
  config: undefined as ClientConfig | undefined,
  connection: "connecting",
  lastEventSeq: 0,
  error: undefined as string | undefined,
  sending: false,
  projects: [] as ProjectRecord[],
  conversations: [] as ConversationRecord[],
  agents: [] as AgentRecord[],
  treeNodes: [] as ConversationTreeNode[],
  approvals: [] as ApprovalWithToolCall[],
  userQuestions: [] as UserQuestionRecord[],
  planReviews: [] as PlanReviewRecord[],
  processes: [] as ProcessRecord[],
  selectedProcessId: undefined as string | undefined,
  processLogs: undefined as ProcessLogQueryResponse | undefined,
  openCenterTabs: [] as CenterTabIdentity[],
  openConversationTabIds: [] as string[],
  openProcessTabIds: [] as string[],
  openFileTabIds: [] as string[],
  settingsTabOpen: false,
  activeConversationTabId: undefined as string | undefined,
  activeCenterTab: undefined as CenterTabIdentity | undefined,
  conversationViews: {} as Record<string, ConversationViewState>,
  pendingConversations: {} as Record<string, PendingConversationState>,
  fileViews: {} as Record<string, FileViewState>,
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
  settingsSaveStatus: "idle" as "idle" | "dirty" | "saving" | "saved" | "error",
  settingsMessage: undefined as string | undefined,
  subscriptionUsage: {} as Record<string, SubscriptionUsage>,
});
