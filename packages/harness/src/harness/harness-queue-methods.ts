import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../types.js";
import type { Conversation } from "./conversation/conversation.js";
import { queueOrWriteMessage } from "./conversation-writes.js";
import { AgentHarnessError } from "./errors.js";
import type { AgentHarnessPhase, PendingConversationWrite } from "./events.js";
import { normalizeHarnessError } from "./harness-events.js";
import { createUserMessage } from "./run/messages.js";

export type InboundQueuedMessage = {
  id?: string;
  source: "user" | "harness";
  message: AgentMessage;
  enqueuedAt: string;
  timestamp?: string;
  priority?: "normal" | "high";
  delivery?: {
    taskId?: string;
    event?: string;
    pendingNotificationId?: string;
  };
};

export type HarnessQueueState = {
  phase: AgentHarnessPhase;
  steerQueue: InboundQueuedMessage[];
  followUpQueue: InboundQueuedMessage[];
  nextTurnQueue: AgentMessage[];
  pendingConversationWrites: PendingConversationWrite[];
  conversation: Conversation;
  emitQueueUpdate(): Promise<void>;
};

export async function steerHarness(
  state: HarnessQueueState,
  text: string,
  options?: { images?: ImageContent[]; id?: string },
): Promise<void> {
  if (state.phase === "idle") {
    throw new AgentHarnessError("invalid_state", "Cannot steer while idle");
  }
  state.steerQueue.push({
    id: options?.id,
    source: "user",
    message: createUserMessage(text, options?.images),
    enqueuedAt: new Date().toISOString(),
  });
  await state.emitQueueUpdate();
}

export async function followUpHarness(
  state: HarnessQueueState,
  text: string,
  options?: { images?: ImageContent[]; id?: string },
): Promise<void> {
  if (state.phase === "idle") {
    throw new AgentHarnessError("invalid_state", "Cannot follow up while idle");
  }
  state.followUpQueue.push({
    id: options?.id,
    source: "user",
    message: createUserMessage(text, options?.images),
    enqueuedAt: new Date().toISOString(),
  });
  await state.emitQueueUpdate();
}

export async function enqueueAutomaticFollowUp(
  state: HarnessQueueState,
  text: string,
): Promise<boolean> {
  if (
    state.steerQueue.length > 0 ||
    state.followUpQueue.length > 0 ||
    state.nextTurnQueue.length > 0
  ) {
    return false;
  }
  state.followUpQueue.push({
    source: "harness",
    message: createUserMessage(text),
    enqueuedAt: new Date().toISOString(),
  });
  await state.emitQueueUpdate();
  return true;
}

export function hasQueuedHarnessInput(state: HarnessQueueState): boolean {
  return (
    state.steerQueue.length > 0 ||
    state.followUpQueue.length > 0 ||
    state.nextTurnQueue.length > 0
  );
}

export async function removeQueuedHarnessMessage(
  state: HarnessQueueState,
  id: string,
): Promise<boolean> {
  const queues = [state.steerQueue, state.followUpQueue];
  for (const queue of queues) {
    const index = queue.findIndex((entry) => entry.id === id);
    if (index === -1) continue;
    const [entry] = queue.splice(index, 1);
    try {
      await state.emitQueueUpdate();
      return true;
    } catch (error) {
      if (entry) queue.splice(index, 0, entry);
      throw normalizeHarnessError(error, "unknown");
    }
  }
  return false;
}

export async function enqueueHarnessMessage(
  state: HarnessQueueState,
  input: {
    id?: string;
    message: AgentMessage;
    timestamp?: string;
    delivery?: InboundQueuedMessage["delivery"];
    priority?: InboundQueuedMessage["priority"];
  },
): Promise<void> {
  if (state.phase === "idle") {
    throw new AgentHarnessError(
      "invalid_state",
      "Cannot enqueue harness message while idle",
    );
  }
  state.steerQueue.push({
    id: input.id,
    source: "harness",
    message: input.message,
    timestamp: input.timestamp,
    enqueuedAt: new Date().toISOString(),
    delivery: input.delivery,
    priority: input.priority,
  });
  await state.emitQueueUpdate();
}

export async function enqueueNextTurn(
  state: HarnessQueueState,
  text: string,
  options?: { images?: ImageContent[] },
): Promise<void> {
  state.nextTurnQueue.push(createUserMessage(text, options?.images));
  await state.emitQueueUpdate();
}

export async function appendHarnessMessage(
  state: HarnessQueueState,
  message: AgentMessage,
): Promise<void> {
  try {
    await queueOrWriteMessage(
      state.phase,
      state.pendingConversationWrites,
      state.conversation,
      message,
    );
  } catch (error) {
    throw normalizeHarnessError(error, "conversation");
  }
}

export async function appendExternalHarnessMessage(
  state: HarnessQueueState,
  input: { id: string; message: AgentMessage; timestamp?: string },
): Promise<void> {
  try {
    await queueOrWriteMessage(
      state.phase,
      state.pendingConversationWrites,
      state.conversation,
      input.message,
      { id: input.id, timestamp: input.timestamp },
    );
  } catch (error) {
    throw normalizeHarnessError(error, "conversation");
  }
}
