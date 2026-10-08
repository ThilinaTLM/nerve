import {
  expandExecutablePromptBlocks,
  type PromptBlockCommandExecutor,
} from "./prompt-block-expansion.js";
import type { AgentHarness } from "@nervekit/harness";
import type { Conversation } from "@nervekit/harness/conversation";
import type { PromptRequest } from "@nervekit/contracts/agents";
import type { WorkbenchLiveExecutionControl } from "../../runs/application/run-live-executions.js";
import type { ConversationHarnessStorage } from "../../conversations/conversation-harness-storage.js";

/** Bind explicit queued prompt IDs to genuine steering, never generated follow-ups. */
export function userPromptControls(
  harness: AgentHarness,
  conversation: Conversation,
  storage: ConversationHarnessStorage,
  expand: (
    text: string,
    images?: PromptRequest["images"],
  ) => Promise<{ text: string }>,
): Pick<
  WorkbenchLiveExecutionControl,
  "steer" | "followUp" | "removeQueuedPrompt"
> {
  const queue = async (
    kind: "steer" | "followUp",
    prompt: Parameters<WorkbenchLiveExecutionControl["steer"]>[0],
  ) => {
    const expanded = await expand(prompt.text, prompt.images);
    storage.registerQueuedPromptAnchor(conversation, prompt.id, {
      kind: "steering",
    });
    try {
      await harness[kind](expanded.text, {
        id: prompt.id,
        images: prompt.images,
      });
    } catch (error) {
      storage.registerQueuedPromptAnchor(conversation, prompt.id);
      throw error;
    }
  };
  return {
    steer: (prompt) => queue("steer", prompt),
    followUp: (prompt) => queue("steer", prompt),
    removeQueuedPrompt: async (id) => {
      const removed = await harness.removeQueuedMessage(id);
      if (removed) storage.registerQueuedPromptAnchor(conversation, id);
      return removed;
    },
  };
}

export function createWorkbenchLiveControl(options: {
  harness: AgentHarness;
  conversation: Conversation;
  storage: ConversationHarnessStorage;
  execute: PromptBlockCommandExecutor;
  signal: AbortSignal;
  durableInputs: boolean;
  onForcePush(): void;
  clearDraftProgress(): void;
  cancel(): Promise<void>;
}) {
  const expandBlocks = (text: string, images?: PromptRequest["images"]) =>
    expandExecutablePromptBlocks(
      options.execute,
      { text, images },
      options.signal,
    );
  const control: WorkbenchLiveExecutionControl = {
    ...userPromptControls(
      options.harness,
      options.conversation,
      options.storage,
      expandBlocks,
    ),
    forcePush: async () => {
      options.onForcePush();
      options.clearDraftProgress();
      if (options.durableInputs) options.harness.interruptTurn();
      else await options.harness.forcePush();
    },
    continue: async () => undefined,
    cancel: options.cancel,
  };
  return { control, expandBlocks };
}
