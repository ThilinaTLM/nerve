import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  StreamFn,
} from "../../types.js";
import type { AgentEventSink } from "./events.js";
import { streamAssistantResponse } from "./stream-assistant.js";
import { executeToolCalls } from "./tool-execution.js";

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
export async function runLoop(
  initialContext: AgentContext,
  newMessages: AgentMessage[],
  initialConfig: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise<void> {
  let currentContext = initialContext;
  let config = initialConfig;
  let firstTurn = true;
  let pendingMessages: AgentMessage[] =
    (await config.getSteeringMessages?.()) || [];

  while (true) {
    if (!firstTurn) {
      await emit({ type: "turn_start" });
    } else {
      firstTurn = false;
    }

    if (pendingMessages.length > 0) {
      for (const message of pendingMessages) {
        await emit({ type: "message_start", message });
        await emit({ type: "message_end", message });
        currentContext.messages.push(message);
        newMessages.push(message);
      }
    }

    const message = await streamAssistantResponse(
      currentContext,
      config,
      signal,
      emit,
      streamFn,
    );
    newMessages.push(message);

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      await emit({ type: "turn_end", message, toolResults: [] });
      await emit({ type: "agent_end", messages: newMessages });
      return;
    }

    const toolCalls = message.content.filter((c) => c.type === "toolCall");
    const toolResults: ToolResultMessage[] = [];
    let hasMoreToolCalls = false;

    if (toolCalls.length > 0) {
      const executedToolBatch = await executeToolCalls(
        currentContext,
        message,
        config,
        signal,
        emit,
      );
      toolResults.push(...executedToolBatch.messages);
      hasMoreToolCalls = !executedToolBatch.terminate;

      for (const result of toolResults) {
        currentContext.messages.push(result);
        newMessages.push(result);
      }
    }

    await emit({ type: "turn_end", message, toolResults });

    const nextTurnContext = {
      message,
      toolResults,
      context: currentContext,
      newMessages,
    };
    const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
    if (nextTurnSnapshot) {
      currentContext = nextTurnSnapshot.context ?? currentContext;
      config = {
        ...config,
        model: nextTurnSnapshot.model ?? config.model,
        reasoning:
          nextTurnSnapshot.thinkingLevel === undefined
            ? config.reasoning
            : nextTurnSnapshot.thinkingLevel === "off"
              ? undefined
              : nextTurnSnapshot.thinkingLevel,
      };
    }

    pendingMessages = (await config.getSteeringMessages?.()) || [];
    if (pendingMessages.length > 0) continue;

    if (
      await config.shouldStopAfterTurn?.({
        message,
        toolResults,
        context: currentContext,
        newMessages,
      })
    ) {
      await emit({ type: "agent_end", messages: newMessages });
      return;
    }

    if (hasMoreToolCalls) continue;
    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}
