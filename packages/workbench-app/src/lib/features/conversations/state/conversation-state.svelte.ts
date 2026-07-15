import type {
  AgentRecord,
  CompletionItem,
  ConversationTreeNode,
  QueuedPromptRecord,
} from "$lib/api";
import type {
  ConversationRenderState,
  TranscriptItem,
} from "@nervekit/workbench-ui/state";

// Transcript/state shapes are owned by the shared workbench-ui package so the
// app effects and the shared reducer/timeline helpers agree on one model.
export type {
  CompactionNotice,
  CompactionNoticeState,
  ConversationRenderState,
  ConversationTransientState,
  RunStatusNotice,
  TaskEventNotice,
  ToolDraftViewModel,
  TranscriptDisplayKind,
  TranscriptItem,
} from "@nervekit/workbench-ui/state";

/**
 * Canonical shared render state plus app-only view concerns (tree, composer,
 * optimistic user rows, loading). The shared `applyConversationEvent` reducer
 * operates on the canonical subset; app effects own the rest.
 */
export interface ConversationViewState extends ConversationRenderState {
  conversationId: string;
  activeEntryId?: string;
  treeNodes: ConversationTreeNode[];
  /** Locally echoed user prompts awaiting their durable entries. */
  optimisticMessages: TranscriptItem[];
  queuedPrompts: QueuedPromptRecord[];
  sending: boolean;
  /** Local Stop request is awaiting server acknowledgment. */
  stopping: boolean;
  composerText: string;
  loading: boolean;
}

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
