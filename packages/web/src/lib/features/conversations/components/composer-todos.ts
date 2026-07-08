import type { TodoItem, ToolCallTranscriptRecord } from "@nervekit/shared";
import { todoItemsField } from "@nervekit/shared-ui/tools/views/tool-view-helpers";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Current todo list for an agent, derived the same way the orchestrator's
 * TodoStateService.hydrateFromToolCalls does: the latest *completed* todos_set
 * call for that agent wins. Returns [] when the agent has no (or a cleared) list.
 *
 * Reads the transcript record previews (`resultPreview`/`argsPreview`). The
 * orchestrator emits the full, untruncated todo list for todos_set/todos_get
 * previews, so the count and list here are accurate.
 */
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
