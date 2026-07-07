import type { ConversationRenderState } from "@nervekit/conversation-ui/state";
import type {
  ManagedSandboxRecord,
  SandboxControllerSessionSummary,
  SandboxSnapshotResult,
  SandboxStatusGetResult,
  SandboxToolCallSummary,
  SandboxWaitSummary,
  ThinkingLevel,
} from "@nervekit/shared";
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

export type SandboxSetupTimelineItem = {
  key: string;
  phase: string;
  status: "started" | "completed" | "failed" | "skipped" | "degraded";
  ts: string;
  detail?: string;
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

export type SandboxDetailState = {
  sandboxId: string;
  record?: ManagedSandboxRecord;
  status?: SandboxStatusGetResult;
  snapshot?: SandboxSnapshotResult;
  latestSession?: SandboxControllerSessionSummary;
  logsTruncated: boolean;
  logsText: string;
  events: SandboxUiEvent[];
  setupTimeline: SandboxSetupTimelineItem[];
  toolCallsById: Record<string, SandboxToolCallSummary>;
  waitsById: Record<string, SandboxWaitSummary>;
  appendedTranscript: Array<{
    entryId: string;
    runId: string;
    role: "user" | "assistant" | "system" | "tool";
    text: string;
    createdAt: string;
  }>;
  liveRuns: Record<string, SandboxLiveRunState>;
  conversationViewsById: Record<string, ConversationRenderState>;
  lastRichSnapshot?: {
    generatedAt?: string;
    cursorSeq?: number;
    stale?: boolean;
    readOnly?: boolean;
    reason?: string;
  };
  selectedConversationId?: string;
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
    events: [],
    setupTimeline: [],
    toolCallsById: {},
    waitsById: {},
    appendedTranscript: [],
    liveRuns: {},
    conversationViewsById: {},
    composerText: "",
    agentControls: defaultAgentControls(),
    controllerConnected: false,
    sending: false,
    loading: false,
  };
}

export type SandboxManagerConnectionState = ManagerWsConnectionState;
