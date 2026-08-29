import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ConversationEntry } from "$lib/api";
import type { TranscriptMenuTarget } from "$lib/presentation/conversations";

export type ConversationMenuHandlers = {
  copyText: (text: string, label?: string) => void | Promise<void>;
  quoteInComposer: (text: string) => void;
  onNavigateToEntry?: (entryId: string | undefined) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenHistory?: () => void;
};

type ConversationMenuContext = ConversationMenuHandlers & {
  treeEntriesById: Map<string, ConversationEntry>;
};

type TargetDetails = {
  content?: string;
  id?: string;
  idLabel?: string;
  quote?: string;
  entryId?: string;
  entry?: ConversationEntry;
};

function baseEntryId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.split(":thinking:")[0];
}

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function joinDetails(parts: Array<string | undefined>): string | undefined {
  const content = parts.filter((part): part is string => Boolean(part?.trim()));
  return content.length > 0 ? content.join("\n") : undefined;
}

function targetDetails(
  target: TranscriptMenuTarget,
  treeEntriesById: Map<string, ConversationEntry>,
): TargetDetails {
  switch (target.kind) {
    case "message":
    case "thinking": {
      const entryId = baseEntryId(target.item.id);
      const entry = entryId ? treeEntriesById.get(entryId) : undefined;
      return {
        content: target.item.text,
        id: target.item.id,
        idLabel: "message id",
        quote: target.item.text,
        entryId: entry ? entryId : undefined,
        entry,
      };
    }
    case "tool": {
      const args = formatValue(target.toolCall.argsPreview);
      const result = formatValue(target.toolCall.resultPreview);
      return {
        content: joinDetails([
          target.toolCall.toolName,
          args ? `Arguments:\n${args}` : undefined,
          result ? `Result:\n${result}` : undefined,
          target.toolCall.error
            ? `Error:\n${target.toolCall.error}`
            : undefined,
        ]),
        id: target.toolCall.id,
        idLabel: "tool id",
        entryId: target.anchorEntryId,
      };
    }
    case "tool_result_error":
      return {
        content: joinDetails([target.toolName, target.error]),
      };
    case "run_status":
      return {
        content: joinDetails([
          `Run ${target.notice.state.replaceAll("_", " ")}`,
          target.notice.errorMessage,
        ]),
        id: target.notice.runId,
        idLabel: "run id",
      };
    case "compaction":
      return {
        content: joinDetails([
          `Compaction ${target.notice.state}`,
          target.notice.summary,
          target.notice.text,
          target.notice.errorMessage,
        ]),
        id: target.notice.id,
        idLabel: "compaction id",
      };
    case "task_event":
      return {
        content: joinDetails([
          target.notice.taskName
            ? `Task: ${target.notice.taskName}`
            : "Task update",
          target.notice.commandPreview,
          target.notice.status ? `Status: ${target.notice.status}` : undefined,
          target.notice.exitCode !== undefined
            ? `Exit: ${target.notice.exitCode}`
            : undefined,
          target.notice.signal ? `Signal: ${target.notice.signal}` : undefined,
        ]),
        id: target.notice.taskId ?? target.notice.entryId,
        idLabel: target.notice.taskId ? "task id" : "entry id",
      };
    case "queued_prompt":
      return {
        content: target.prompt.text,
        id: target.prompt.id,
        idLabel: "queued prompt id",
      };
  }
}

function grouped(groups: ContextMenuItem[][]): ContextMenuItem[] {
  const nonEmpty = groups.filter((group) => group.length > 0);
  return nonEmpty.flatMap((group, index) =>
    index === 0
      ? group
      : [{ type: "separator" } satisfies ContextMenuItem, ...group],
  );
}

export function transcriptMenuModel(
  target: TranscriptMenuTarget,
  selectedText: string | undefined,
  context: ConversationMenuContext,
): ContextMenuItem[] {
  const details = targetDetails(target, context.treeEntriesById);
  const content = details.content?.trim() ? details.content : undefined;
  const selection = selectedText?.trim() ? selectedText : undefined;

  const copyGroup: ContextMenuItem[] = [
    {
      label: "Copy selection",
      disabled: !selection,
      onSelect: () => {
        if (selection) void context.copyText(selection, "selection");
      },
    },
    {
      label: "Copy content",
      disabled: !content,
      onSelect: () => {
        if (content) void context.copyText(content, "content");
      },
    },
  ];
  if (details.quote?.trim()) {
    copyGroup.push({
      label: "Quote",
      onSelect: () => context.quoteInComposer(details.quote ?? ""),
    });
  }

  const actionGroup: ContextMenuItem[] = [];
  if (
    target.kind === "message" &&
    details.entry?.role === "user" &&
    context.onEditEntry
  ) {
    actionGroup.push({
      label: "Edit message",
      onSelect: () => context.onEditEntry?.(details.entry as ConversationEntry),
    });
  }
  if (target.kind === "queued_prompt") {
    actionGroup.push(
      {
        label: "Force push all queued prompts",
        disabled: target.busy || !target.canForcePush,
        onSelect: target.onForcePush,
      },
      {
        label: "Edit prompt",
        disabled: target.busy || !target.canEdit,
        onSelect: target.onEdit,
      },
      {
        label: "Discard",
        destructive: true,
        disabled: target.busy || !target.canDiscard,
        onSelect: target.onDiscard,
      },
    );
  }
  if (details.entryId && context.onNavigateToEntry) {
    actionGroup.push({
      label: "Continue from here",
      onSelect: () => context.onNavigateToEntry?.(details.entryId),
    });
  }

  const metadataGroup: ContextMenuItem[] = [];
  if (details.id) {
    metadataGroup.push({
      label: "Copy ID",
      onSelect: () =>
        void context.copyText(details.id ?? "", details.idLabel ?? "id"),
    });
  }
  if (context.onOpenHistory) {
    metadataGroup.push({
      label: "Branch history",
      onSelect: context.onOpenHistory,
    });
  }

  return grouped([copyGroup, actionGroup, metadataGroup]);
}
