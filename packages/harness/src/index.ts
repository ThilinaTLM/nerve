export { Agent, type AgentOptions } from "./agent/agent.js";
export {
  agentLoop,
  agentLoopContinue,
  runAgentLoop,
  runAgentLoopContinue,
} from "./agent/loop/agent-loop.js";
export {
  AgentToolSuspension,
  type AgentToolSuspensionData,
  isAgentToolSuspension,
} from "./agent/suspension.js";
export {
  type AgentToolAdapterOptions,
  type AgentToolDefinitionLike,
  type AgentToolHostExecute,
  createAgentToolsFromDefinitions,
} from "./agent/tool-adapter.js";
export {
  type AgentEvent,
  type AgentState,
} from "./agent/contracts/agent-state.js";
export {
  type AnyModel,
  type QueueMode,
  type ThinkingLevel,
  type ToolExecutionMode,
} from "./agent/contracts/agent-common.js";
export {
  type AfterToolCallContext,
  type AgentContext,
  type AgentLoopConfig,
  type AgentLoopTurnUpdate,
  type BeforeToolCallContext,
  type PrepareNextTurnContext,
  type ShouldStopAfterTurnContext,
  type StreamFn,
} from "./agent/contracts/agent-loop.js";
export {
  type AgentMessage,
  type CustomAgentMessages,
} from "./agent/contracts/agent-messages.js";
export {
  type AfterToolCallResult,
  type AgentTool,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type BeforeToolCallResult,
} from "./agent/contracts/agent-tools.js";
export {
  type ImageExplanationAuth,
  explainImageWithModel,
} from "./models/image/explanation.js";
export { registerManagedProvider } from "./models/model-registry.js";
export { isRetryableProviderError } from "./models/provider-errors.js";
export {
  clampAgentThinkingLevel,
  getAgentModelInfo,
  getModelContextWindow,
  listAvailableModels,
  resolveAgentModel,
} from "./models/resolution.js";
export { registerAgentScriptedProvider } from "./models/scripted-provider.js";
export {
  type AgentCustomModel,
  type AgentModelInfo,
  type AgentModelSelection,
  type AgentScriptedProviderStep,
} from "./models/model-contracts.js";
export { AgentHarness } from "./harness/agent-harness.js";
export {
  type CompactionSummaryProfile,
  type GenerateSummaryInput,
  type SummaryStreamProgress,
  compact,
  generateSummary,
  prepareCompaction,
} from "./compaction/compaction.js";
export { findCutPoint, findTurnStartIndex } from "./compaction/cut-points.js";
export { isContextOverflowAssistantMessage } from "./compaction/overflow.js";
export {
  AUTO_COMPACTION_PROFILES,
  DEFAULT_AUTO_COMPACTION_SETTINGS,
  DEFAULT_COMPACTION_SETTINGS,
  deriveAutoCompactionPolicy,
  resolveAutoCompactionPercentages,
  shouldAutoCompact,
  shouldCompact,
} from "./compaction/policy.js";
export {
  type AutoCompactionConfiguration,
  type AutoCompactionPolicy,
  type AutoCompactionReason,
} from "./compaction/types.js";
export {
  calculateContextTokens,
  computeContextUsage,
  estimateContextTokens,
  estimateTokens,
  getCompactionDecisionTokens,
  getLastAssistantUsage,
  getLatestCompactionEntry,
} from "./compaction/usage.js";
export { serializeConversation } from "./compaction/utils.js";
export {
  type AgentHarnessOptions,
  type AgentHarnessPromptOptions,
  type AgentHarnessResources,
  type AgentHarnessStreamOptions,
  type AgentHarnessStreamOptionsPatch,
  type PromptTemplate,
  type Skill,
} from "./harness/configuration/options.js";
export {
  type ConversationContext,
  type ConversationState,
  buildContextMessages,
  buildConversationContext,
  extractConversationState,
} from "./conversation/context.js";
export { Conversation } from "./conversation/conversation.js";
export { ConversationTreeState } from "./conversation/conversation-tree-state.js";
export {
  type ActiveToolsChangeEntry,
  type BranchSummaryEntry,
  type CompactionEntry,
  type ConversationInfoEntry,
  type ConversationMetadata,
  type ConversationStorage,
  type ConversationTreeEntry,
  type ConversationTreeEntryBase,
  type CustomEntry,
  type CustomMessageEntry,
  type LabelEntry,
  type LeafEntry,
  type MessageEntry,
  type ModelChangeEntry,
  type ThinkingLevelChangeEntry,
} from "./conversation/entries.js";
export { uuidv7 } from "./conversation/uuid.js";
export {
  type ExecutionEnv,
  type ExecutionEnvExecOptions,
  type FileInfo,
  type FileKind,
  type FileSystem,
  type Shell,
} from "./environment/contracts.js";
export {
  AgentHarnessError,
  type AgentHarnessErrorCode,
  BranchSummaryError,
  type BranchSummaryErrorCode,
  CompactionError,
  type CompactionErrorCode,
  ConversationError,
  type ConversationErrorCode,
  ExecutionError,
  type ExecutionErrorCode,
  FileError,
  type FileErrorCode,
} from "./errors.js";
export {
  type AbortEvent,
  type AbortResult,
  type AfterProviderResponseEvent,
  type AgentHarnessEvent,
  type AgentHarnessEventResultMap,
  type AgentHarnessOwnEvent,
  type AgentHarnessPhase,
  type BeforeAgentStartEvent,
  type BeforeAgentStartResult,
  type BeforeProviderPayloadEvent,
  type BeforeProviderPayloadResult,
  type BeforeProviderRequestEvent,
  type BeforeProviderRequestResult,
  type BranchSummaryResult,
  type CompactResult,
  type CompactionPreparation,
  type CompactionSettings,
  type ContextEvent,
  type ContextResult,
  type ConversationBeforeCompactEvent,
  type ConversationBeforeCompactResult,
  type ConversationBeforeTreeEvent,
  type ConversationBeforeTreeResult,
  type ConversationCompactEvent,
  type ConversationTreeEvent,
  type FileOperations,
  type GenerateBranchSummaryOptions,
  type IterationBoundaryEvent,
  type IterationBoundaryResult,
  type ModelUpdateEvent,
  type NavigateTreeResult,
  type PendingConversationWrite,
  type QueueDrainedEvent,
  type QueueUpdateEvent,
  type ResourcesUpdateEvent,
  type SavePointEvent,
  type SettledEvent,
  type ThinkingLevelUpdateEvent,
  type ToolCallEvent,
  type ToolCallResult,
  type ToolResultEvent,
  type ToolResultPatch,
  type ToolsUpdateEvent,
  type TreePreparation,
} from "./harness/lifecycle/events.js";
export {
  BRANCH_SUMMARY_PREFIX,
  BRANCH_SUMMARY_SUFFIX,
  type BashExecutionMessage,
  type BranchSummaryMessage,
  COMPACTION_SUMMARY_PREFIX,
  COMPACTION_SUMMARY_SUFFIX,
  type CompactionSummaryMessage,
  type CustomMessage,
  type HarnessMessage,
  type HarnessTaskEvent,
  type HarnessTaskEventDetails,
  bashExecutionToText,
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
  createHarnessMessage,
} from "./messages/messages.js";
export {
  type PromptTemplateDiagnostic,
  type PromptTemplateDiagnosticCode,
  formatPromptTemplateInvocation,
  loadPromptTemplates,
  loadSourcedPromptTemplates,
  parseCommandArgs,
  substituteArgs,
} from "./resources/prompt-templates.js";
export {
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
} from "./resources/skills/format.js";
export {
  type SkillDiagnostic,
  type SkillDiagnosticCode,
  loadSkills,
  loadSourcedSkills,
} from "./resources/skills/loader.js";
export {
  type SkillFrontmatter,
  parseFrontmatter,
} from "./resources/skills/parser.js";
export {
  validateDescription,
  validateName,
} from "./resources/skills/validation.js";
export {
  type Result,
  err,
  getOrThrow,
  getOrUndefined,
  ok,
  toError,
} from "./result.js";
