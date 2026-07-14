import type {
  AgentRecord,
  CompletionItem,
  ContextUsage,
  ConversationActiveRunSnapshot,
  ConversationTreeNode,
  QueuedPromptRecord,
  ToolCallTranscriptRecord,
} from "$lib/api";
import type {
  ConversationLiveState,
  TranscriptItem,
} from "@nervekit/workbench-ui/state";

// Transcript/live state shapes are owned by the shared workbench-ui package so
// the app reducers and the shared timeline/drain helpers agree on one model.
export type {
  CompactionNotice,
  CompactionNoticeState,
  ConversationLiveState,
  LiveMessageMeta,
  LiveToolCallDraft,
  LiveToolOutput,
  LiveToolOutputChunk,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptDisplayKind,
  TranscriptItem,
} from "@nervekit/workbench-ui/state";

export type ConversationViewState = {
  conversationId: string;
  activeEntryId?: string;
  activeEntryIds: string[];
  transcript: TranscriptItem[];
  toolCalls: ToolCallTranscriptRecord[];
  treeNodes: ConversationTreeNode[];
  streamingText: string;
  live: ConversationLiveState;
  activeRun?: ConversationActiveRunSnapshot;
  queuedPrompts: QueuedPromptRecord[];
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
  approvalPolicy: AgentRecord["approvalPolicy"];
  sending: boolean;
  error?: string;
  createdAt: string;
};

export const conversationState = $state({
  conversationViews: {} as Record<string, ConversationViewState>,
  pendingConversations: {} as Record<string, PendingConversationState>,
  openConversationTabIds: [] as string[],
  activeConversationTabId: undefined as string | undefined,
  slashCompletions: [] as CompletionItem[],
  selectedModelKey: "nerve-faux:faux-fast",
  selectedThinkingLevel: "off" as AgentRecord["thinkingLevel"],
  selectedMode: "coding" as AgentRecord["mode"],
  selectedPermissionLevel: "autonomous" as AgentRecord["permissionLevel"],
  selectedApprovalPolicy: {
    autoApproveReadOnly: true,
  } as AgentRecord["approvalPolicy"],
});
