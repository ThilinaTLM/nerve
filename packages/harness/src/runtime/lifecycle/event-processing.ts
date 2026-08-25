import type {
  AgentEvent,
  AgentMessage,
  AnyModel,
} from "../../agent/types/index.js";
import type { Conversation } from "../conversation/conversation.js";
import type { PendingConversationWrite } from "./events.js";
import type { AgentHarnessOwnEvent } from "./events.js";
import { createFailureMessage } from "../run/messages.js";

export interface HarnessEventProcessingContext {
  conversation: Conversation;
  pendingConversationWrites: PendingConversationWrite[];
  queuedMessageWrites: WeakMap<
    AgentMessage,
    { id?: string; timestamp?: string }
  >;
  flushPendingConversationWrites: () => Promise<void>;
  emitAny: (event: AgentEvent, signal?: AbortSignal) => Promise<void>;
  emitOwn: (event: AgentHarnessOwnEvent, signal?: AbortSignal) => Promise<void>;
  settle: () => void;
  getNextTurnCount: () => number;
}

export async function processHarnessAgentEvent(
  context: HarnessEventProcessingContext,
  event: AgentEvent,
  signal?: AbortSignal,
): Promise<void> {
  if (event.type === "message_end") {
    const queuedWrite = context.queuedMessageWrites.get(event.message);
    context.queuedMessageWrites.delete(event.message);
    if (queuedWrite?.id) {
      await context.conversation.appendMessageWithId(
        queuedWrite.id,
        event.message,
        queuedWrite.timestamp,
      );
    } else {
      await context.conversation.appendMessage(event.message);
    }
    await context.emitAny(event, signal);
    return;
  }

  if (event.type === "turn_end") {
    let eventError: unknown;
    try {
      await context.emitAny(event, signal);
    } catch (error) {
      eventError = error;
    }
    const hadPendingMutations = context.pendingConversationWrites.length > 0;
    await context.flushPendingConversationWrites();
    if (eventError) throw eventError;
    await context.emitOwn({ type: "save_point", hadPendingMutations });
    return;
  }

  if (event.type === "agent_end") {
    await context.flushPendingConversationWrites();
    context.settle();
    await context.emitAny(event, signal);
    await context.emitOwn(
      { type: "settled", nextTurnCount: context.getNextTurnCount() },
      signal,
    );
    return;
  }

  await context.emitAny(event, signal);
}

export async function emitHarnessRunFailure(options: {
  context: HarnessEventProcessingContext;
  model: AnyModel;
  error: unknown;
  aborted: boolean;
  signal: AbortSignal;
}): Promise<AgentMessage[]> {
  const failureMessage = createFailureMessage(
    options.model,
    options.error,
    options.aborted,
  );
  const process = async (event: AgentEvent) =>
    await processHarnessAgentEvent(options.context, event, options.signal);

  await process({ type: "message_start", message: failureMessage });
  await process({ type: "message_end", message: failureMessage });
  await process({
    type: "turn_end",
    message: failureMessage,
    toolResults: [],
  });
  await process({ type: "agent_end", messages: [failureMessage] });
  return [failureMessage];
}
