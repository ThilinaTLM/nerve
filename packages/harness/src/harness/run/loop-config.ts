import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
} from "../../agent/contracts/index.js";
import { convertToLlm } from "../../messages/messages.js";
import type { PromptTemplate, Skill } from "../configuration/options.js";
import type { AgentHarnessTurnState } from "../configuration/turn-state.js";
import type {
  AgentHarnessEventResultMap,
  AgentHarnessOwnEvent,
} from "../lifecycle/events.js";
import type { HarnessStreamFn } from "./execution.js";

/** Capabilities the agent loop needs from its owning harness. */
export interface HarnessLoopConfigContext<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> {
  readonly maxParallelToolCalls: number | undefined;
  readonly hasPendingTurnInput?: () => Promise<boolean>;
  emitHook<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>,
  ): Promise<AgentHarnessEventResultMap[TType] | undefined>;
  flushPendingConversationWrites(): Promise<void>;
  createTurnState(
    refresh?: boolean,
  ): Promise<AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>>;
  createContext(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    systemPrompt?: string,
  ): AgentContext;
  getRunSignal(): AbortSignal | undefined;
  enqueueAutomaticFollowUp(text: string): Promise<boolean>;
  hasQueuedSteeringOrFollowUp(): boolean;
  drainSteeringMessages(): Promise<AgentMessage[]>;
  drainFollowUpMessages(): Promise<AgentMessage[]>;
}

/**
 * Wires the agent loop's provider-dispatch refresh, tool-call hooks,
 * iteration boundary and queue draining to the harness's hook/event system.
 */
export function createHarnessLoopConfig<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  context: HarnessLoopConfigContext<TSkill, TPromptTemplate, TTool>,
  getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  setTurnState: (
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ) => void,
  streamFn: HarnessStreamFn,
  initialSystemPrompt?: string,
): AgentLoopConfig {
  let invocationSystemPrompt = initialSystemPrompt;
  const turnState = getTurnState();
  return {
    model: turnState.model,
    prepareProviderDispatch: async () => {
      const result = await streamFn.prepareRequest();
      if (result.kind === "ready") return result;
      await context.flushPendingConversationWrites();
      const refreshed = await context.createTurnState(true);
      setTurnState(refreshed);
      return {
        kind: "refresh",
        update: {
          context: context.createContext(refreshed, invocationSystemPrompt),
          model: refreshed.model,
          thinkingLevel: refreshed.thinkingLevel,
        },
      };
    },
    maxParallelToolCalls: context.maxParallelToolCalls,
    reasoning:
      turnState.thinkingLevel === "off" ? undefined : turnState.thinkingLevel,
    convertToLlm,
    transformContext: async (messages) => {
      const result = await context.emitHook({
        type: "context",
        messages: [...messages],
      });
      return result?.messages ?? messages;
    },
    beforeToolCall: async ({ toolCall, args }) => {
      const result = await context.emitHook({
        type: "tool_call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: args as Record<string, unknown>,
      });
      return result
        ? { block: result.block, reason: result.reason }
        : undefined;
    },
    afterToolCall: async ({ toolCall, args, result, isError }) => {
      const patch = await context.emitHook({
        type: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: args as Record<string, unknown>,
        content: result.content,
        details: result.details,
        isError,
      });
      return patch
        ? {
            content: patch.content,
            details: patch.details,
            isError: patch.isError,
            terminate: patch.terminate,
          }
        : undefined;
    },
    prepareNextTurn: async (turn) => {
      // before_agent_start overrides belong only to the initial logical invocation.
      invocationSystemPrompt = undefined;
      await context.flushPendingConversationWrites();
      const boundaryResult = await context.emitHook({
        type: "iteration_boundary",
        message: turn.message,
        toolResults: turn.toolResults,
        hasMoreToolCalls: turn.hasMoreToolCalls,
        signal: context.getRunSignal() ?? new AbortController().signal,
      });
      if (boundaryResult?.followUp && !turn.hasMoreToolCalls) {
        await context.enqueueAutomaticFollowUp(boundaryResult.followUp);
      }
      if (
        !turn.hasMoreToolCalls &&
        context.hasPendingTurnInput &&
        !context.hasQueuedSteeringOrFollowUp() &&
        !(await context.hasPendingTurnInput())
      )
        return undefined;
      const nextTurnState = await context.createTurnState();
      setTurnState(nextTurnState);
      return {
        continue: ["user", "harness"].includes(
          nextTurnState.messages.at(-1)?.role ?? "",
        ),
        context: context.createContext(nextTurnState),
        model: nextTurnState.model,
        thinkingLevel: nextTurnState.thinkingLevel,
      };
    },
    getSteeringMessages: () => context.drainSteeringMessages(),
    getFollowUpMessages: () => context.drainFollowUpMessages(),
  };
}
