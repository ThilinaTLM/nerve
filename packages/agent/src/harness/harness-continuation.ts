import type { AssistantMessage } from "@earendil-works/pi-ai";
import { runAgentLoopContinue } from "../agent-loop.js";
import { isAgentToolSuspension } from "../suspension.js";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AnyModel,
} from "../types.js";
import { AgentHarnessError } from "./errors.js";
import { normalizeHarnessError } from "./harness-events.js";
import type { PromptTemplate, Skill } from "./options.js";
import { toError } from "./result.js";
import type { AgentHarnessTurnState } from "./turn-state.js";

export type HarnessContinuationState<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> = {
  phase: string;
  runAbortController?: AbortController;
  startRunPromise(): () => void;
  createTurnState(): Promise<
    AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>
  >;
  createContext(
    turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ): unknown;
  createLoopConfig(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    setTurnState: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) => void,
  ): never;
  handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void>;
  createStreamFn(
    getTurnState: () => AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ): never;
  emitRunFailure(
    model: AnyModel,
    error: unknown,
    aborted: boolean,
    signal: AbortSignal,
  ): Promise<AgentMessage[]>;
  flushPendingConversationWrites(): Promise<void>;
};

export async function continueHarnessRun<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessContinuationState<TSkill, TPromptTemplate, TTool>,
): Promise<AssistantMessage> {
  if (state.phase !== "idle") {
    throw new AgentHarnessError("busy", "AgentHarness is busy");
  }
  state.phase = "turn";
  const finishRunPromise = state.startRunPromise();
  let activeTurnState = await state.createTurnState();
  const abortController = new AbortController();
  const getTurnState = () => activeTurnState;
  const setTurnState = (
    nextTurnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  ) => {
    activeTurnState = nextTurnState;
  };
  state.runAbortController = abortController;
  try {
    const newMessages = await runAgentLoopContinue(
      state.createContext(activeTurnState) as never,
      state.createLoopConfig(getTurnState, setTurnState),
      (event) => state.handleAgentEvent(event, abortController.signal),
      abortController.signal,
      state.createStreamFn(getTurnState),
    );
    for (const message of [...newMessages].reverse()) {
      if (message.role === "assistant") return message;
    }
    throw new AgentHarnessError(
      "invalid_state",
      "AgentHarness continue completed without an assistant message",
    );
  } catch (error) {
    if (isAgentToolSuspension(error)) {
      state.phase = "idle";
      throw error;
    }
    try {
      const failureMessages = await state.emitRunFailure(
        activeTurnState.model,
        error,
        abortController.signal.aborted,
        abortController.signal,
      );
      const assistant = [...failureMessages]
        .reverse()
        .find(
          (message): message is AssistantMessage =>
            message.role === "assistant",
        );
      if (assistant) return assistant;
    } catch (failureError) {
      const cause = new AggregateError(
        [toError(error), toError(failureError)],
        "Agent continuation failed and failure reporting failed",
      );
      throw new AgentHarnessError("unknown", cause.message, cause);
    }
    throw normalizeHarnessError(error, "unknown");
  } finally {
    try {
      await state.flushPendingConversationWrites();
    } finally {
      state.runAbortController = undefined;
      finishRunPromise();
    }
  }
}
