import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  SimpleStreamOptions,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type {
  AnyModel,
  ThinkingLevel,
  ToolExecutionMode,
} from "./agent-common.js";
import type { AgentMessage } from "./agent-messages.js";
import type {
  AfterToolCallResult,
  AgentTool,
  AgentToolCall,
  AgentToolResult,
  BeforeToolCallResult,
} from "./agent-tools.js";

/**
 * Stream function used by the agent loop.
 *
 * Contract:
 * - Must not throw or return a rejected promise for request/model/harness failures.
 * - Must return an AssistantMessageEventStream.
 * - Failures must be encoded in the returned stream via protocol events and a
 *   final AssistantMessage with stopReason "error" or "aborted" and errorMessage.
 */
export type StreamFn = (
  model: AnyModel,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/** Context passed to `beforeToolCall`. */
export interface BeforeToolCallContext {
  /** The assistant message that requested the tool call. */
  assistantMessage: AssistantMessage;
  /** The raw tool call block from `assistantMessage.content`. */
  toolCall: AgentToolCall;
  /** Validated tool arguments for the target tool schema. */
  args: unknown;
  /** Current agent context at the time the tool call is prepared. */
  context: AgentContext;
}

/** Context passed to `afterToolCall`. */
export interface AfterToolCallContext {
  /** The assistant message that requested the tool call. */
  assistantMessage: AssistantMessage;
  /** The raw tool call block from `assistantMessage.content`. */
  toolCall: AgentToolCall;
  /** Validated tool arguments for the target tool schema. */
  args: unknown;
  /** The executed tool result before any `afterToolCall` overrides are applied. */
  result: AgentToolResult<unknown>;
  /** Whether the executed tool result is currently treated as an error. */
  isError: boolean;
  /** Current agent context at the time the tool call is finalized. */
  context: AgentContext;
}

/** Context passed to `shouldStopAfterTurn`. */
export interface ShouldStopAfterTurnContext {
  /** The assistant message that completed the turn. */
  message: AssistantMessage;
  /** Tool result messages passed to the preceding `turn_end` event. */
  toolResults: ToolResultMessage[];
  /** Current agent context after the turn's assistant message and tool results have been appended. */
  context: AgentContext;
  /** Messages that this loop invocation will return if it exits at this point. Prompt runs include the initial prompt messages; continuation runs do not include pre-existing context messages. */
  newMessages: AgentMessage[];
}

/** Replacement runtime state used by the agent loop before starting another provider request. */
export interface AgentLoopTurnUpdate {
  /** Context for the next provider request. */
  context?: AgentContext;
  /** Model for the next provider request. */
  model?: AnyModel;
  /** Thinking level for the next provider request. */
  thinkingLevel?: ThinkingLevel;
}

export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {
  /** Whether completed tool execution naturally requires another provider turn. */
  hasMoreToolCalls: boolean;
}

export interface AgentLoopConfig extends SimpleStreamOptions {
  model: AnyModel;

  /**
   * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
   *
   * Each AgentMessage must be converted to a UserMessage, AssistantMessage, or ToolResultMessage
   * that the LLM can understand. AgentMessages that cannot be converted (e.g., UI-only notifications,
   * status messages) should be filtered out.
   *
   * Contract: must not throw or reject. Return a safe fallback value instead.
   * Throwing interrupts the low-level agent loop without producing a normal event sequence.
   *
   * @example
   * ```typescript
   * convertToLlm: (messages) => messages.flatMap(m => {
   *   if (m.role === "custom") {
   *     // Convert custom message to user message
   *     return [{ role: "user", content: m.content, timestamp: m.timestamp }];
   *   }
   *   if (m.role === "notification") {
   *     // Filter out UI-only messages
   *     return [];
   *   }
   *   // Pass through standard LLM messages
   *   return [m];
   * })
   * ```
   */
  convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  /**
   * Optional transform applied to the context before `convertToLlm`.
   *
   * Use this for operations that work at the AgentMessage level:
   * - Context window management (pruning old messages)
   * - Injecting context from external sources
   *
   * Contract: must not throw or reject. Return the original messages or another
   * safe fallback value instead.
   *
   * @example
   * ```typescript
   * transformContext: async (messages) => {
   *   if (estimateTokens(messages) > MAX_TOKENS) {
   *     return pruneOldMessages(messages);
   *   }
   *   return messages;
   * }
   * ```
   */
  transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;

  /**
   * Resolves an API key dynamically for each LLM call.
   *
   * Useful for short-lived OAuth tokens (e.g., GitHub Copilot) that may expire
   * during long-running tool execution phases.
   *
   * Contract: must not throw or reject. Return undefined when no key is available.
   */
  getApiKey?: (
    provider: string,
  ) => Promise<string | undefined> | string | undefined;

  /**
   * Called after each turn fully completes and `turn_end` has been emitted.
   *
   * If it returns true, the loop emits `agent_end` and exits before polling steering or follow-up queues,
   * without starting another LLM call. The current assistant response and any tool executions finish normally.
   *
   * Use this to request a graceful stop after the current turn, e.g. before context gets too full.
   *
   * Contract: must not throw or reject. Throwing interrupts the low-level agent loop without producing a normal event sequence.
   */
  shouldStopAfterTurn?: (
    context: ShouldStopAfterTurnContext,
  ) => boolean | Promise<boolean>;

  /**
   * Called after `turn_end` and before the loop decides whether another provider request should start.
   * Return replacement context/model/thinking state to affect the next turn in this run.
   * Return undefined to keep using the current context/config.
   */
  prepareNextTurn?: (
    context: PrepareNextTurnContext,
  ) =>
    | AgentLoopTurnUpdate
    | undefined
    | Promise<AgentLoopTurnUpdate | undefined>;

  /**
   * Returns steering messages to inject into the conversation mid-run.
   *
   * Called after the current assistant turn finishes executing its tool calls, unless `shouldStopAfterTurn` exits first.
   * If messages are returned, they are added to the context before the next LLM call.
   * Tool calls from the current assistant message are not skipped.
   *
   * Use this for "steering" the agent while it's working.
   *
   * Contract: must not throw or reject. Return [] when no steering messages are available.
   */
  getSteeringMessages?: () => Promise<AgentMessage[]>;

  /**
   * Returns follow-up messages to process after the agent would otherwise stop.
   *
   * Called when the agent has no more tool calls and no steering messages.
   * If messages are returned, they're added to the context and the agent
   * continues with another turn.
   *
   * Use this for follow-up messages that should wait until the agent finishes.
   *
   * Contract: must not throw or reject. Return [] when no follow-up messages are available.
   */
  getFollowUpMessages?: () => Promise<AgentMessage[]>;

  /**
   * Tool execution mode.
   * - "sequential": execute tool calls one by one
   * - "parallel": preflight tool calls sequentially, then execute allowed tools concurrently;
   *   emit `tool_execution_end` in tool completion order after each tool is finalized,
   *   then emit tool-result message artifacts later in assistant source order
   *
   * Default: "parallel"
   */
  toolExecution?: ToolExecutionMode;

  /**
   * Called before a tool is executed, after arguments have been validated.
   *
   * Return `{ block: true }` to prevent execution. The loop emits an error tool result instead.
   * The hook receives the agent abort signal and is responsible for honoring it.
   */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;

  /**
   * Called after a tool finishes executing, before `tool_execution_end` and tool-result message events are emitted.
   *
   * Return an `AfterToolCallResult` to override parts of the executed tool result:
   * - `content` replaces the full content array
   * - `details` replaces the full details payload
   * - `isError` replaces the error flag
   * - `terminate` replaces the early-termination hint
   *
   * Any omitted fields keep their original values. No deep merge is performed.
   * The hook receives the agent abort signal and is responsible for honoring it.
   */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}

/** Context snapshot passed into the low-level agent loop. */
export interface AgentContext {
  /** System prompt included with the request. */
  systemPrompt: string;
  /** Transcript visible to the model. */
  messages: AgentMessage[];
  /** Tools available for this run. */
  tools?: AgentTool[];
}
