import type {
  BoundedText,
  ManagedSandboxRecord,
  SandboxConfigYamlResult,
  SandboxControllerSessionSummary,
  SandboxConversationSnapshot,
  SandboxSnapshotResult,
  SandboxStatusGetResult,
  SandboxToolCallSummary,
  SandboxWaitSummary,
  SandboxWorkspaceFileResponse,
  ThinkingLevel,
} from "@nervekit/shared";
import type { ConversationRenderState } from "@nervekit/shared-ui/state";
import type { ManagerWsConnectionState } from "../api/manager-ws-client.svelte";
import { createDraftFromStoredPreferences } from "./create-sandbox-draft";

/** Runtime agent controls surfaced by the composer toolbar. */
export type SandboxAgentControls = {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  mode: "normal" | "planning";
  permissionLevel: "read_only" | "supervised" | "autonomous";
  approvalPolicy: { autoApproveReadOnly: boolean };
};

export function defaultAgentControls(): SandboxAgentControls {
  const draft = createDraftFromStoredPreferences();
  return {
    provider: draft.mainProvider,
    model: draft.mainModel,
    thinkingLevel: draft.mainThinking,
    mode: draft.mode,
    permissionLevel: draft.permissionLevel,
    approvalPolicy: { autoApproveReadOnly: true },
  };
}

export type SandboxUiEvent = {
  stream: string;
  seq: number;
  id?: string;
  ts: string;
  type: string;
  durability?: "durable" | "transient";
  data?: unknown;
  sandboxId?: string;
};

export type SandboxTimelineRow =
  | {
      kind: "message";
      key: string;
      role: "user" | "assistant" | "system" | "tool";
      text: string;
      streaming?: boolean;
      createdAt?: string;
    }
  | { kind: "tool"; key: string; toolCall: SandboxToolCallSummary }
  | { kind: "wait"; key: string; wait: SandboxWaitSummary }
  | { kind: "run-status"; key: string; runId: string; status: string };

export type SandboxLiveRunState = {
  runId: string;
  conversationId: string;
  agentId: string;
  status: string;
  deltaText: string;
  updatedAt?: string;
};

export type SandboxDiagnosticTabId = "logs" | "config" | "events";
export type SandboxUtilityTab = "context" | "git";

export type SandboxWorkspaceTabIdentity =
  | { kind: "summary"; id: "summary" }
  | { kind: "chat"; id: string }
  | { kind: "file"; id: string }
  | { kind: "diagnostic"; id: SandboxDiagnosticTabId };

export const sandboxSummaryTab: SandboxWorkspaceTabIdentity = {
  kind: "summary",
  id: "summary",
};

export type SandboxWorkspaceFileViewState = {
  id: string;
  path: string;
  line?: number;
  content?: SandboxWorkspaceFileResponse;
  displayMode: "raw" | "rendered";
  wrapLines: boolean;
  loading: boolean;
  error?: string;
};

export type SandboxSetupTimelineItem = {
  key: string;
  /** Broad setup group (`config`, `git`, `github`, `boot`, `skills`, `ready`). */
  phase: string;
  /** Specific boot phase name when the event comes from a boot script phase. */
  name?: string;
  index?: number;
  status:
    | "started"
    | "completed"
    | "failed"
    | "timeout"
    | "skipped"
    | "degraded";
  ts: string;
  detail?: string;
  runAs?: "sandbox" | "root";
  network?: "inherit" | "deny" | "package_registries_only";
  timeoutMs?: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  stdout?: BoundedText;
  stderr?: BoundedText;
  error?: string;
  limitations?: string[];
};

export type PendingSandboxOperation = {
  key: string;
  kind: "create" | "start" | "stop" | "restart" | "remove" | "command";
  sandboxId?: string;
  label: string;
  status: "pending" | "completed" | "error";
  error?: string;
  startedAt: number;
};

export type SandboxPendingConversationState = {
  id: string;
  title: "New Conversation";
  composerText: string;
  queuedPrompt?: string;
  sending: boolean;
  error?: string;
  createdAt: string;
};

export type SandboxDetailState = {
  sandboxId: string;
  record?: ManagedSandboxRecord;
  status?: SandboxStatusGetResult;
  snapshot?: SandboxSnapshotResult;
  latestSession?: SandboxControllerSessionSummary;
  logsTruncated: boolean;
  logsText: string;
  logsAvailable?: boolean;
  logsLimitations?: string[];
  configYaml?: string;
  configYamlSource?: SandboxConfigYamlResult["source"];
  configYamlDigest?: string;
  configYamlLoading: boolean;
  configYamlError?: string;
  events: SandboxUiEvent[];
  setupTimeline: SandboxSetupTimelineItem[];
  toolCallsById: Record<string, SandboxToolCallSummary>;
  waitsById: Record<string, SandboxWaitSummary>;
  appendedTranscript: Array<{
    entryId: string;
    conversationId?: string;
    agentId?: string;
    runId: string;
    role: "user" | "assistant" | "system" | "tool";
    text: string;
    createdAt: string;
  }>;
  liveRuns: Record<string, SandboxLiveRunState>;
  conversationViewsById: Record<string, ConversationRenderState>;
  localConversationsById: Record<string, SandboxConversationSnapshot>;
  pendingConversationsById: Record<string, SandboxPendingConversationState>;
  composerTextByConversationId: Record<string, string>;
  queuedPromptByConversationId: Record<string, string | undefined>;
  openWorkspaceTabs: SandboxWorkspaceTabIdentity[];
  activeWorkspaceTab: SandboxWorkspaceTabIdentity | undefined;
  workspaceFileViewsById: Record<string, SandboxWorkspaceFileViewState>;
  lastRichSnapshot?: {
    generatedAt?: string;
    cursorSeq?: number;
    stale?: boolean;
    readOnly?: boolean;
    reason?: string;
  };
  selectedConversationId?: string;
  selectedPendingConversationId?: string;
  selectedAgentId?: string;
  selectedRunId?: string;
  composerText: string;
  agentControls: SandboxAgentControls;
  queuedPrompt?: string;
  /** Live controller connectivity, updated from the sandbox event stream. */
  controllerConnected: boolean;
  sending: boolean;
  loading: boolean;
  error?: string;
  disconnectExitAt?: string;
};

export function createSandboxDetailState(
  sandboxId: string,
): SandboxDetailState {
  return {
    sandboxId,
    logsTruncated: false,
    logsText: "",
    logsAvailable: undefined,
    logsLimitations: undefined,
    configYamlLoading: false,
    events: [],
    setupTimeline: [],
    toolCallsById: {},
    waitsById: {},
    appendedTranscript: [],
    liveRuns: {},
    conversationViewsById: {},
    localConversationsById: {},
    pendingConversationsById: {},
    composerTextByConversationId: {},
    queuedPromptByConversationId: {},
    openWorkspaceTabs: [sandboxSummaryTab],
    activeWorkspaceTab: sandboxSummaryTab,
    workspaceFileViewsById: {},
    composerText: "",
    agentControls: defaultAgentControls(),
    controllerConnected: false,
    sending: false,
    loading: false,
  };
}

export type SandboxManagerConnectionState = ManagerWsConnectionState;
