import { asRecord } from "$lib/presentation/utils/as-record";
import type { TodoItem } from "@nervekit/contracts/tools";
import type { ToolCallTranscriptRecord } from "$lib/presentation/view-models/conversation";
import { todoItemsField } from "../tools/views/tool-view-helpers.js";

export function currentTodosForAgent(
  toolCalls: ToolCallTranscriptRecord[],
  agentId: string | undefined,
): TodoItem[] {
  if (!agentId) return [];
  let latest: ToolCallTranscriptRecord | undefined;
  for (const call of toolCalls) {
    if (
      call.toolName === "todos_set" &&
      call.status === "completed" &&
      call.agentId === agentId &&
      (!latest || call.updatedAt.localeCompare(latest.updatedAt) >= 0)
    ) {
      latest = call;
    }
  }
  if (!latest) return [];
  const details = asRecord(asRecord(latest.resultPreview).details);
  return (
    todoItemsField(details.todos) ??
    todoItemsField(asRecord(latest.argsPreview).todos) ??
    []
  );
}
