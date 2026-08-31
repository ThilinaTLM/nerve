import type {
  AssistantMessageEvent,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { AnyModel, ThinkingLevel } from "./agent-common.js";
import type { AgentMessage } from "./agent-messages.js";
import type { AgentTool } from "./agent-tools.js";

/**
 * Public agent state.
 *
 * `tools` and `messages` use accessor properties so implementations can copy
 * assigned arrays before storing them.
 */
export interface AgentState {
  /** System prompt sent with each model request. */
  systemPrompt: string;
  /** Active model used for future turns. */
  model: AnyModel;
  /** Requested reasoning level for future turns. */
  thinkingLevel: ThinkingLevel;
  /** Available tools. Assigning a new array copies the top-level array. */
  set tools(tools: AgentTool[]);
  get tools(): AgentTool[];
  /** Conversation transcript. Assigning a new array copies the top-level array. */
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  /**
   * True while the agent is processing a prompt or continuation.
   *
   * This remains true until awaited `agent_end` listeners settle.
   */
  readonly isStreaming: boolean;
  /** Partial assistant message for the current streamed response, if any. */
  readonly streamingMessage?: AgentMessage;
  /** Tool call ids currently executing. */
  readonly pendingToolCalls: ReadonlySet<string>;
  /** Error message from the most recent failed or aborted assistant turn, if any. */
  readonly errorMessage?: string;
}

/**
 * Events emitted by the Agent for UI updates.
 *
 * `agent_end` is the last event emitted for a run, but awaited `Agent.subscribe()`
 * listeners for that event are still part of run settlement. The agent becomes
 * idle only after those listeners finish.
 */
export type AgentEvent =
  // Agent lifecycle
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  // Turn lifecycle - a turn is one assistant response + any tool calls/results
  | { type: "turn_start" }
  | {
      type: "turn_end";
      message: AgentMessage;
      toolResults: ToolResultMessage[];
    }
  // Message lifecycle - emitted for user, assistant, and toolResult messages
  | { type: "message_start"; message: AgentMessage }
  // Only emitted for assistant messages during streaming
  | {
      type: "message_update";
      message: AgentMessage;
      assistantMessageEvent: AssistantMessageEvent;
    }
  | { type: "message_end"; message: AgentMessage }
  // Tool execution lifecycle
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    };
