import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  AgentMessage,
  AnyModel,
  ThinkingLevel,
} from "../types.js";
import type {
  BranchSummaryEntry,
  CompactionEntry,
  ConversationTreeEntry,
} from "./conversation/entries.js";
import type {
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  AgentHarnessStreamOptionsPatch,
  PromptTemplate,
  Skill,
} from "./options.js";

export type AgentHarnessPhase =
  | "idle"
  | "turn"
  | "compaction"
  | "branch_summary"
  | "retry";

export type PendingConversationWrite =
  ConversationTreeEntry extends infer TEntry
    ? TEntry extends ConversationTreeEntry
      ? Omit<TEntry, "id" | "parentId" | "timestamp">
      : never
    : never;

export interface QueueUpdateEvent {
  type: "queue_update";
  steer: AgentMessage[];
  followUp: AgentMessage[];
  nextTurn: AgentMessage[];
}

export interface SavePointEvent {
  type: "save_point";
  hadPendingMutations: boolean;
}

export interface AbortEvent {
  type: "abort";
  clearedSteer: AgentMessage[];
  clearedFollowUp: AgentMessage[];
}

export interface SettledEvent {
  type: "settled";
  nextTurnCount: number;
}

export interface BeforeAgentStartEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  type: "before_agent_start";
  prompt: string;
  images?: ImageContent[];
  systemPrompt: string;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
}

export interface ContextEvent {
  type: "context";
  messages: AgentMessage[];
}

export interface BeforeProviderRequestEvent {
  type: "before_provider_request";
  model: AnyModel;
  conversationId: string;
  streamOptions: AgentHarnessStreamOptions;
}

export interface BeforeProviderPayloadEvent {
  type: "before_provider_payload";
  model: AnyModel;
  payload: unknown;
}

export interface AfterProviderResponseEvent {
  type: "after_provider_response";
  status: number;
  headers: Record<string, string>;
}

export interface ToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<TextContent | ImageContent>;
  details: unknown;
  isError: boolean;
}

export interface ConversationBeforeCompactEvent {
  type: "conversation_before_compact";
  preparation: CompactionPreparation;
  branchEntries: ConversationTreeEntry[];
  customInstructions?: string;
  signal: AbortSignal;
}

export interface ConversationCompactEvent {
  type: "conversation_compact";
  compactionEntry: CompactionEntry;
  fromHook: boolean;
}

export interface ConversationBeforeTreeEvent {
  type: "conversation_before_tree";
  preparation: TreePreparation;
  signal: AbortSignal;
}

export interface ConversationTreeEvent {
  type: "conversation_tree";
  newLeafId: string | null;
  oldLeafId: string | null;
  summaryEntry?: BranchSummaryEntry;
  fromHook?: boolean;
}

export interface ModelUpdateEvent {
  type: "model_update";
  model: AnyModel;
  previousModel: AnyModel | undefined;
  source: "set" | "restore";
}

export interface ThinkingLevelUpdateEvent {
  type: "thinking_level_update";
  level: ThinkingLevel;
  previousLevel: ThinkingLevel;
}

export interface ToolsUpdateEvent {
  type: "tools_update";
  toolNames: string[];
  previousToolNames: string[];
  activeToolNames: string[];
  previousActiveToolNames: string[];
  source: "set" | "restore";
}

export interface ResourcesUpdateEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  type: "resources_update";
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  previousResources: AgentHarnessResources<TSkill, TPromptTemplate>;
}

export type AgentHarnessOwnEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> =
  | QueueUpdateEvent
  | SavePointEvent
  | AbortEvent
  | SettledEvent
  | BeforeAgentStartEvent<TSkill, TPromptTemplate>
  | ContextEvent
  | BeforeProviderRequestEvent
  | BeforeProviderPayloadEvent
  | AfterProviderResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | ConversationBeforeCompactEvent
  | ConversationCompactEvent
  | ConversationBeforeTreeEvent
  | ConversationTreeEvent
  | ModelUpdateEvent
  | ThinkingLevelUpdateEvent
  | ResourcesUpdateEvent<TSkill, TPromptTemplate>
  | ToolsUpdateEvent;

export type AgentHarnessEvent<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> = AgentEvent | AgentHarnessOwnEvent<TSkill, TPromptTemplate>;

export interface BeforeAgentStartResult {
  messages?: AgentMessage[];
  systemPrompt?: string;
}

export interface ContextResult {
  messages: AgentMessage[];
}

export interface BeforeProviderRequestResult {
  streamOptions?: AgentHarnessStreamOptionsPatch;
}

export interface BeforeProviderPayloadResult {
  payload: unknown;
}

export interface ToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface ToolResultPatch {
  content?: Array<TextContent | ImageContent>;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}

export interface ConversationBeforeCompactResult {
  cancel?: boolean;
  compaction?: CompactResult;
}

export interface ConversationBeforeTreeResult {
  cancel?: boolean;
  summary?: { summary: string; details?: unknown };
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export type AgentHarnessEventResultMap = {
  before_agent_start: BeforeAgentStartResult | undefined;
  context: ContextResult | undefined;
  before_provider_request: BeforeProviderRequestResult | undefined;
  before_provider_payload: BeforeProviderPayloadResult | undefined;
  after_provider_response: undefined;
  tool_call: ToolCallResult | undefined;
  tool_result: ToolResultPatch | undefined;
  conversation_before_compact: ConversationBeforeCompactResult | undefined;
  conversation_compact: undefined;
  conversation_before_tree: ConversationBeforeTreeResult | undefined;
  conversation_tree: undefined;
  model_update: undefined;
  thinking_level_update: undefined;
  resources_update: undefined;
  tools_update: undefined;
  queue_update: undefined;
  save_point: undefined;
  abort: undefined;
  settled: undefined;
};

export interface AbortResult {
  clearedSteer: AgentMessage[];
  clearedFollowUp: AgentMessage[];
}

export interface CompactResult {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
}

export interface NavigateTreeResult {
  cancelled: boolean;
  editorText?: string;
  summaryEntry?: BranchSummaryEntry;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: CompactionSettings;
}

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export interface TreePreparation {
  targetId: string;
  oldLeafId: string | null;
  commonAncestorId: string | null;
  entriesToSummarize: ConversationTreeEntry[];
  userWantsSummary: boolean;
  customInstructions?: string;
  replaceInstructions?: boolean;
  label?: string;
}

export interface GenerateBranchSummaryOptions {
  model: AnyModel;
  apiKey: string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  customInstructions?: string;
  replaceInstructions?: boolean;
  reserveTokens?: number;
}

export interface BranchSummaryResult {
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
}
