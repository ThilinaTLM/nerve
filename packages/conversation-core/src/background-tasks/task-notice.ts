import type { EnqueueNoticeRequest } from "../inputs/input-queue.service.js";
import { createId } from "@nervekit/contracts";
import type { TaskRef, TaskTerminal } from "./background-task.js";

/** The one parent-facing notice for a task that reached a terminal outcome. */
export function buildTaskNotice(
  ref: TaskRef,
  terminal: TaskTerminal,
): EnqueueNoticeRequest {
  return {
    conversationId: ref.parentConversationId,
    inputId: terminal.noticeInputId ?? createId("input"),
    subtype: "task_result",
    producer: ref.id,
    text: terminal.text,
    details: {
      task:
        terminal.detail.kind === "bash"
          ? { kind: "bash", id: ref.id, exitCode: terminal.detail.exitCode }
          : {
              kind: "subagent",
              id: ref.id,
              assignmentId: terminal.detail.assignmentId,
            },
      outcome: terminal.outcome,
      assetIds: terminal.assetIds,
    },
    wakeWhenIdle: true,
  };
}
