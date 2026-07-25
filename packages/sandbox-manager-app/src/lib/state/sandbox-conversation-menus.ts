import { Clipboard, Copy, Pencil, TextQuote, Trash2 } from "@lucide/svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import type { TranscriptMenuTarget } from "@nervekit/workbench-ui/components/conversation";

async function copyText(text: string, label: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notifyCopyResult(true, label);
  } catch {
    notifyCopyResult(false, label);
  }
}

export type SandboxTranscriptMenuHandlers = {
  /** Insert quoted message text into the active composer. */
  quoteInComposer?: (text: string) => void;
};

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function contentFor(target: TranscriptMenuTarget): string | undefined {
  switch (target.kind) {
    case "message":
    case "thinking":
      return target.item.text;
    case "tool":
      return [
        target.toolCall.toolName,
        formatValue(target.toolCall.argsPreview),
        formatValue(target.toolCall.resultPreview),
        target.toolCall.error,
      ]
        .filter(Boolean)
        .join("\n");
    case "tool_result_error":
      return `${target.toolName}\n${target.error}`;
    case "run_status":
      return [
        `Run ${target.notice.state.replaceAll("_", " ")}`,
        target.notice.errorMessage,
      ]
        .filter(Boolean)
        .join("\n");
    case "compaction":
      return [
        `Compaction ${target.notice.state}`,
        target.notice.summary,
        target.notice.text,
        target.notice.errorMessage,
      ]
        .filter(Boolean)
        .join("\n");
    case "task_event":
      return [
        target.notice.taskName ?? "Task update",
        target.notice.commandPreview,
        target.notice.status,
        target.notice.exitCode === undefined
          ? undefined
          : `Exit: ${target.notice.exitCode}`,
        target.notice.signal,
      ]
        .filter(Boolean)
        .join("\n");
    case "queued_prompt":
      return target.prompt.text;
  }
}

function idFor(
  target: TranscriptMenuTarget,
): { value: string; label: string } | undefined {
  switch (target.kind) {
    case "message":
    case "thinking":
      return target.item.id
        ? { value: target.item.id, label: "message id" }
        : undefined;
    case "tool":
      return { value: target.toolCall.id, label: "tool id" };
    case "run_status":
      return target.notice.runId
        ? { value: target.notice.runId, label: "run id" }
        : undefined;
    case "compaction":
      return { value: target.notice.id, label: "compaction id" };
    case "task_event": {
      const value = target.notice.taskId ?? target.notice.entryId;
      return value
        ? {
            value,
            label: target.notice.taskId ? "task id" : "entry id",
          }
        : undefined;
    }
    case "queued_prompt":
      return { value: target.prompt.id, label: "queued prompt id" };
    case "tool_result_error":
      return undefined;
  }
}

function grouped(groups: ContextMenuItem[][]): ContextMenuItem[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) =>
      index === 0
        ? group
        : [{ type: "separator" } satisfies ContextMenuItem, ...group],
    );
}

/** Compact context menu shared by every meaningful sandbox transcript row. */
export function sandboxTranscriptMenu(
  target: TranscriptMenuTarget,
  selectedText: string | undefined,
  handlers: SandboxTranscriptMenuHandlers = {},
): ContextMenuItem[] {
  const content = contentFor(target)?.trim() || undefined;
  const selection = selectedText?.trim() ? selectedText : undefined;
  const copyGroup: ContextMenuItem[] = [
    {
      label: "Copy selection",
      icon: Copy,
      disabled: !selection,
      onSelect: () => selection && void copyText(selection, "selection"),
    },
    {
      label: "Copy content",
      icon: Clipboard,
      disabled: !content,
      onSelect: () => content && void copyText(content, "content"),
    },
  ];
  if (
    (target.kind === "message" || target.kind === "thinking") &&
    target.item.text &&
    handlers.quoteInComposer
  ) {
    copyGroup.push({
      label: "Quote",
      icon: TextQuote,
      onSelect: () => handlers.quoteInComposer?.(target.item.text),
    });
  }

  const actionGroup: ContextMenuItem[] = [];
  if (target.kind === "queued_prompt") {
    actionGroup.push(
      {
        label: "Edit prompt",
        icon: Pencil,
        disabled: target.busy || !target.canEdit,
        onSelect: target.onEdit,
      },
      {
        label: "Discard",
        icon: Trash2,
        destructive: true,
        disabled: target.busy || !target.canDiscard,
        onSelect: target.onDiscard,
      },
    );
  }

  const id = idFor(target);
  const metadataGroup: ContextMenuItem[] = id
    ? [
        {
          label: "Copy ID",
          icon: Copy,
          onSelect: () => void copyText(id.value, id.label),
        },
      ]
    : [];
  return grouped([copyGroup, actionGroup, metadataGroup]);
}
