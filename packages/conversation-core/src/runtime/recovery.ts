import type { AsyncBashService } from "../async-bash/async-bash.service.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import { openExecutionId, type StatusService } from "./status.js";
import type { ConversationScheduler } from "./scheduler.js";

type RecoveryInput = {
  storage: CoreStorage;
  toolCalls: Pick<ToolCallService, "recover" | "openRows">;
  inputs: Pick<InputQueueService, "hasDeliverable">;
  asyncBash: Pick<AsyncBashService, "recover" | "hasRecoverable">;
  status: Pick<StatusService, "transition" | "refresh">;
  scheduler: Pick<ConversationScheduler, "enable" | "wake">;
};

const EXECUTION_START = { kind: "execution_start", executionId: "" } as const;

/** Open tool calls, running tasks, an open execution or queued input need recovery work. */
function needsRecovery(input: RecoveryInput, id: string): boolean {
  if (
    input.toolCalls.openRows(id).length > 0 ||
    input.asyncBash.hasRecoverable(id) ||
    openExecutionId(input.storage, id) !== null
  )
    return true;
  try {
    return input.inputs.hasDeliverable(id, EXECUTION_START);
  } catch {
    // Damaged input takes the full path; the wake step reports it.
    return true;
  }
}

export async function recoverCore(input: RecoveryInput): Promise<void> {
  const recovered: string[] = [];
  for (const { id } of input.storage.conversations.identities()) {
    try {
      if (!input.storage.conversations.get(id)) continue;
      if (!needsRecovery(input, id)) {
        input.status.refresh(id);
        continue;
      }
      // Containment: never resume or settle work in a conversation whose history
      // no longer parses. Validation reads the whole history, so idle
      // conversations skip it; their reads report failures when opened.
      input.storage.events.validate(id);
      await input.toolCalls.recover(id);
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
      if (input.inputs.hasDeliverable(id, EXECUTION_START))
        input.scheduler.wake(id);
    } catch (error) {
      input.storage.conversations.reportFailure(id, "recovery.wake", error);
    }
  }
}
