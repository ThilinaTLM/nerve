import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentLoopTurnUpdate,
  AgentMessage,
  StreamFn,
} from "../contracts/index.js";
import type { AgentEventSink } from "./loop-events.js";
import { streamAssistantResponse } from "./assistant-stream.js";
import { executeToolCalls } from "./tool-execution.js";

function applyTurnUpdate(
  config: AgentLoopConfig,
  update: AgentLoopTurnUpdate,
): AgentLoopConfig {
  return {
    ...config,
    model: update.model ?? config.model,
    reasoning:
      update.thinkingLevel === undefined
        ? config.reasoning
        : update.thinkingLevel === "off"
          ? undefined
          : update.thinkingLevel,
  };
}

/**
 * Main loop logic shared by runAgentLoop and runAgentLoopContinue.
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

    let response;
    let refreshes = 0;
    do {
      response = await streamAssistantResponse(
        currentContext,
        config,
        signal,
        emit,
        streamFn,
      );
      if (response.kind === "refresh") {
        // Applications can impose a stricter combined preparation/dispatch budget.
        if (++refreshes > 64)
          throw new Error("Provider preparation exceeded refresh limit");
        currentContext = response.update.context ?? currentContext;
        config = applyTurnUpdate(config, response.update);
      }
    } while (response.kind === "refresh");
    const message = response.message;
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
      hasMoreToolCalls,
    };
    const nextTurnSnapshot = await config.prepareNextTurn?.(nextTurnContext);
    if (nextTurnSnapshot) {
      currentContext = nextTurnSnapshot.context ?? currentContext;
      config = applyTurnUpdate(config, nextTurnSnapshot);
    }

    if (signal?.aborted) {
      await emit({ type: "agent_end", messages: newMessages });
      return;
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

    if (hasMoreToolCalls || nextTurnSnapshot?.continue) continue;

    pendingMessages = (await config.getFollowUpMessages?.()) || [];
    if (pendingMessages.length > 0) continue;
    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}
