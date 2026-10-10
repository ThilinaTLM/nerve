import type { AsyncBashService } from "../async-bash/async-bash.service.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import { openExecutionId, type StatusService } from "./status.js";
import type { ConversationScheduler } from "./scheduler.js";

export async function recoverCore(input: {
  storage: CoreStorage;
  toolCalls: ToolCallService;
  inputs: InputQueueService;
  asyncBash: AsyncBashService;
  status: StatusService;
  scheduler: ConversationScheduler;
}): Promise<void> {
  await input.toolCalls.recover();
  await input.inputs.recover();
  await input.asyncBash.recover();
  for (const conversation of input.storage.conversations.listAll()) {
    const executionId = openExecutionId(input.storage, conversation.id);
    if (executionId && !input.toolCalls.openRows(conversation.id).length)
      input.status.transition(conversation.id, {
        subtype: "execution_state",
        transition: "interrupted",
        executionId,
      });
    else input.status.refresh(conversation.id);
  }
  input.scheduler.enable();
  for (const conversation of input.storage.conversations.listAll()) {
    // Recovery only starts providers for queued input, never to repair an old execution.
    if (
      input.inputs.hasDeliverable(conversation.id, {
        kind: "execution_start",
        executionId: "",
      })
    )
      input.scheduler.wake(conversation.id);
  }
}
