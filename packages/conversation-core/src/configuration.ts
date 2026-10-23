import type {
  ConversationConfig,
  PreviewSystemPromptResult,
} from "@nervekit/contracts/core";
import type {
  LeadSettingsOverrides,
  ProfileTarget,
} from "@nervekit/contracts/agent-configuration";
import type {
  ProfileConfirmation,
  ProfileRefreshRequired,
  ProfileTransitionResult,
  PreviewProfileTransitionResult,
  SetConversationAgentProfileRequest,
} from "@nervekit/contracts/agent-configuration";
import type { ModelSelection, ThinkingLevel } from "@nervekit/contracts/models";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import type { TurnPreparationInput } from "./ports.js";
import type { CreateConversationInput } from "./conversations/conversation.service.js";

export type ConversationContext = Pick<ConversationConfig, "workingDirectory"> &
  Partial<Pick<ConversationConfig, "systemPrompt" | "instructions">>;
export interface ConfigurationPreviewInput {
  conversation: TurnPreparationInput["conversation"];
  config: ConversationContext;
  projectDir: string;
  coreTools: ToolDefinition[];
  overrides?: LeadSettingsOverrides;
  agentProfile?: ProfileTarget;
}

export interface RetryPreferences {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
}

/** Non-secret host capture. Its identity is process-local and is never persisted. */
export interface RequestConfigurationCapture {
  /** Identifies the executor configuration advertised by this request, not current policy. */
  id: string;
  model: ModelSelection;
  reasoningLevel: ThinkingLevel;
  agentProfile: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  /** Synchronous publication guard covering all asynchronous preparation dependencies. */
  isCurrent(): boolean;
}
export interface CompactionConfigurationCapture {
  model: ModelSelection;
  reasoningLevel: ThinkingLevel;
  settings: AutoCompactionSettings;
  isCurrent(): boolean;
}

export interface ProfileTransitionInput extends ProfileConfirmation {
  conversationId: string;
  kind: "profile" | "plan-approval";
  action?: SetConversationAgentProfileRequest["action"];
  toolCallId?: string;
}
export interface ProfileLifecyclePort {
  preview(
    conversationId: string,
    profile: string,
  ): Promise<PreviewProfileTransitionResult>;
  apply(input: ProfileTransitionInput): Promise<ProfileTransitionResult>;
  /** Reconcile receipts only; never apply an uncommitted accepted decision on recovery. */
  reconcile(input: ProfileTransitionInput): Promise<ProfileTransitionResult>;
  reject(
    input: ProfileTransitionInput,
    reason: ProfileRefreshRequired["reason"],
  ): Promise<ProfileTransitionResult>;
}

/** JSON configuration authority supplied by the host; core never resolves agent settings from SQL. */
export interface AgentConfigurationPort {
  /** Best-effort validated JSON projection for history, never an execution fallback. */
  historyContext?(
    conversationId: string,
  ): Partial<Pick<ConversationConfig, "systemPrompt" | "instructions">>;
  /** Context-only edit of the conversation JSON document; null clears a field. */
  configureContext(
    conversationId: string,
    patch: Partial<Pick<ConversationConfig, "systemPrompt" | "instructions">>,
  ): Promise<void>;
  profiles: ProfileLifecyclePort;
  /** Disposable display projection. Never used for execution. */
  summary?(
    conversationId: string,
  ): Partial<
    Pick<
      ConversationConfig,
      "model" | "reasoningLevel" | "permissionRuleSetId" | "agentProfile"
    >
  >;
  resolveConfig(
    conversationId: string,
    context: ConversationContext,
  ): Promise<ConversationConfig>;
  prepareCreation(
    input: CreateConversationInput,
  ): Promise<Omit<ConversationConfig, "conversationId">>;
  /** Release when preparation is discarded or all calls from the request have settled. */
  releaseRequest?(captureId: string): void;
  /** Identity exists, but no execution may start before durable configuration creation completes. */
  initializeConversation(
    input: CreateConversationInput & { id: string },
  ): Promise<void>;
  capturePreview(
    input: ConfigurationPreviewInput,
  ): Promise<PreviewSystemPromptResult>;
  captureRequest(
    input: TurnPreparationInput & {
      coreTools: ToolDefinition[];
      signal?: AbortSignal;
    },
  ): Promise<RequestConfigurationCapture>;
  captureCompaction(
    conversationId: string,
  ): Promise<CompactionConfigurationCapture>;
  /** Called once at the beginning of a runner retry sequence, not once per attempt. */
  captureRetry(conversationId: string): Promise<RetryPreferences>;
}
