import type { AsyncBashService } from "../async-bash/async-bash.service.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import { openExecutionId, type StatusService } from "./status.js";
import type { ConversationScheduler } from "./scheduler.js";

export async function recoverCore(input: {
  storage: CoreStorage;
  toolCalls: Pick<ToolCallService, "recover" | "openRows">;
  inputs: Pick<InputQueueService, "recover" | "hasDeliverable">;
  asyncBash: Pick<AsyncBashService, "recover">;
  status: Pick<StatusService, "transition" | "refresh">;
  scheduler: Pick<ConversationScheduler, "enable" | "wake">;
}): Promise<void> {
  const recovered: string[] = [];
  for (const { id } of input.storage.conversations.identities()) {
    try {
      if (!input.storage.conversations.get(id)) continue;
      input.storage.events.validate(id);
      await input.toolCalls.recover(id);
      await input.inputs.recover(id);
      await input.asyncBash.recover(id);
      const executionId = openExecutionId(input.storage, id);
      if (executionId && !input.toolCalls.openRows(id).length)
        input.status.transition(id, {
          subtype: "execution_state",
          transition: "interrupted",
          executionId,
        });
      else if (!input.status.refresh(id)) continue;
      recovered.push(id);
    } catch (error) {
      input.storage.conversations.reportFailure(id, "recovery", error);
    }
  }
  input.scheduler.enable();
  for (const id of recovered) {
    try {
      // Recovery only starts providers for queued input, never to repair an old execution.
      if (
        input.inputs.hasDeliverable(id, {
          kind: "execution_start",
          executionId: "",
        })
      )
        input.scheduler.wake(id);
    } catch (error) {
      input.storage.conversations.reportFailure(id, "recovery.wake", error);
    }
  }
}
