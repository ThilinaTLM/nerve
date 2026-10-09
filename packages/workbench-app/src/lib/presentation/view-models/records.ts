/** Presentation-owned records shapes. No runtime schemas. */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ProjectRecord = {
  id: string;
  name: string;
  dir: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentRecord = {
  id: string;
  conversationId: string;
  projectId: string;
  projectDir: string;
  mode: "planning" | "coding";
  thinkingLevel:
    | "off"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max";
  createdAt: string;
  updatedAt: string;
  parentAgentId?: string | undefined;
  executionKind?: "explore" | "root" | "async_developer" | undefined;
  name?: string | undefined;
  permissionRuleSetId?: string | undefined;
  systemPrompt?: string | undefined;
  task?: string | undefined;
  model?: { provider: string; modelId: string } | undefined;
};

export type QueuedPromptRecord = {
  id: string;
  agentId: string;
  conversationId: string;
  projectId: string;
  behavior: "steer" | "follow-up";
  text: string;
  status: "queued" | "failed" | "cancelled" | "accepted" | "delivered";
  createdAt: string;
  updatedAt: string;
  runId?: string | undefined;
  images?: { type: "image"; data: string; mimeType: string }[] | undefined;
  deliveredEntryId?: string | undefined;
  error?: string | undefined;
};

export type AgentActivitySnapshot = {
  agentId: string;
  conversationId: string;
  state:
    | "error"
    | "running"
    | "idle"
    | "awaiting_user"
    | "awaiting_async"
    | "aborted";
  pendingInteractionCount: number;
  pendingAsyncCount: number;
  updatedAt: string;
};

export type ConversationRecord = {
  id: string;
  projectId: string;
  title: string;
  mode: "planning" | "coding";
  createdAt: string;
  updatedAt: string;
  activeAgentId?: string | undefined;
  activeEntryId?: string | undefined;
  lastUserMessageAt?: string | undefined;
  pinned?: boolean | undefined;
  completedAt?: string | undefined;
  runtimeStatusClearedAt?: string | undefined;
};

export type ConversationEntry = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  kind:
    | "message"
    | "tool_result"
    | "inline_command_result"
    | "subagent_run_event"
    | "compaction"
    | "branch_summary"
    | "explore_report"
    | "run_status"
    | "task_event";
  text: string;
  createdAt: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  turnId?: string | undefined;
  liveMessageId?: string | undefined;
  messageOrdinal?: number | undefined;
  parentEntryId?: string | undefined;
  summary?: string | undefined;
  tokensBefore?: number | undefined;
  usage?:
    | {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
        cost: number;
      }
    | undefined;
  firstKeptEntryId?: string | undefined;
  fromEntryId?: string | undefined;
  details?: unknown;
};

export type ConversationTreeNode = {
  entry: {
    id: string;
    conversationId: string;
    role: "user" | "assistant" | "system";
    kind:
      | "message"
      | "tool_result"
      | "inline_command_result"
      | "subagent_run_event"
      | "compaction"
      | "branch_summary"
      | "explore_report"
      | "run_status"
      | "task_event";
    text: string;
    createdAt: string;
    agentId?: string | undefined;
    runId?: string | undefined;
    turnId?: string | undefined;
    liveMessageId?: string | undefined;
    messageOrdinal?: number | undefined;
    parentEntryId?: string | undefined;
    summary?: string | undefined;
    tokensBefore?: number | undefined;
    usage?:
      | {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          totalTokens: number;
          cost: number;
        }
      | undefined;
    firstKeptEntryId?: string | undefined;
    fromEntryId?: string | undefined;
    details?: unknown;
  };
  childEntryIds: string[];
};

export type AgentActivityState = AgentActivitySnapshot["state"];

export type SubagentTranscriptEntry = ConversationEntry;
