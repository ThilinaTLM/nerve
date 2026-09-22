/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  StreamFn,
} from "../contracts/index.js";
import type { AgentEventSink } from "./loop-events.js";
import { runLoop } from "./turn-loop.js";

export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}

export async function runAgentLoopContinue(
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise<AgentMessage[]> {
  if (context.messages.length === 0) {
    throw new Error("Cannot continue: no messages in context");
  }

  const newMessages: AgentMessage[] = [];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });

  if (context.messages[context.messages.length - 1].role === "assistant") {
    const steering = (await config.getSteeringMessages?.()) ?? [];
    const followUps =
      steering.length === 0
        ? ((await config.getFollowUpMessages?.()) ?? [])
        : [];
    const queued = steering.length > 0 ? steering : followUps;
    if (queued.length === 0) {
      throw new Error("Cannot continue from message role: assistant");
    }
    currentContext.messages.push(...queued);
    newMessages.push(...queued);
    for (const message of queued) {
      await emit({ type: "message_start", message });
      await emit({ type: "message_end", message });
    }
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}
