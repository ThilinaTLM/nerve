import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Clipboard from "@lucide/svelte/icons/clipboard";
import Copy from "@lucide/svelte/icons/copy";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Pencil from "@lucide/svelte/icons/pencil";
import TextQuote from "@lucide/svelte/icons/text-quote";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import type { ConversationEntry, ToolCallTranscriptRecord } from "$lib/api";
import type { TranscriptItem } from "$lib/core/types/state-types";

export type ConversationMenuHandlers = {
  copyText: (text: string, label?: string) => void | Promise<void>;
  quoteInComposer: (text: string) => void;
  onNavigateToEntry?: (entryId: string | undefined) => void;
  onEditEntry?: (entry: ConversationEntry) => void;
  onOpenHistory?: () => void;
};

type ConversationMenuContext = ConversationMenuHandlers & {
  treeEntriesById: Map<string, ConversationEntry>;
  parentEntryIdById: Map<string, string | undefined>;
};

function baseEntryId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.split(":thinking:")[0];
}

function parentEntryIdFor(
  id: string | undefined,
  parentEntryIdById: Map<string, string | undefined>,
): string | undefined {
  const baseId = baseEntryId(id);
  return baseId ? parentEntryIdById.get(baseId) : undefined;
}

function entryForTranscriptItem(
  item: TranscriptItem,
  treeEntriesById: Map<string, ConversationEntry>,
): ConversationEntry | undefined {
  const id = baseEntryId(item.id);
  return id ? treeEntriesById.get(id) : undefined;
}

export function messageMenu(
  item: TranscriptItem,
  context: ConversationMenuContext,
): ContextMenuItem[] {
  const entryId = baseEntryId(item.id);
  const canBranch = Boolean(entryId && context.treeEntriesById.has(entryId));
  const entry = entryForTranscriptItem(item, context.treeEntriesById);
  const items: ContextMenuItem[] = [];

  if (canBranch) {
    items.push(
      {
        label: "Continue from here",
        icon: ArrowRight,
        onSelect: () => context.onNavigateToEntry?.(entryId),
      },
      {
        label: "Fork from before this message",
        icon: GitBranch,
        onSelect: () =>
          context.onNavigateToEntry?.(
            parentEntryIdFor(item.id, context.parentEntryIdById),
          ),
      },
    );
    if (entry?.role === "user") {
      items.push({
        label: "Edit & resend",
        icon: Pencil,
        onSelect: () => context.onEditEntry?.(entry),
      });
    }
    items.push({ type: "separator" });
  }

  items.push(
    {
      label: "Copy text",
      icon: Clipboard,
      onSelect: () => void context.copyText(item.text),
    },
    {
      label: "Quote in composer",
      icon: TextQuote,
      onSelect: () => context.quoteInComposer(item.text),
    },
  );
  if (item.id) {
    items.push({ type: "separator" });
    items.push({
      label: "Copy message id",
      icon: Copy,
      onSelect: () => void context.copyText(item.id ?? "", "message id"),
    });
  }
  if (context.onOpenHistory) {
    items.push({ type: "separator" });
    items.push({
      label: "Show branch history",
      icon: GitBranch,
      onSelect: context.onOpenHistory,
    });
  }
  return items;
}

export function toolMenu(
  anchorEntryId: string | undefined,
  toolCall: ToolCallTranscriptRecord,
  handlers: ConversationMenuHandlers,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (anchorEntryId) {
    items.push({
      label: "Continue after this tool result",
      icon: ArrowRight,
      onSelect: () => handlers.onNavigateToEntry?.(anchorEntryId),
    });
    items.push({ type: "separator" });
  }
  items.push({
    label: "Copy tool id",
    icon: Copy,
    onSelect: () => void handlers.copyText(toolCall.id, "tool id"),
  });
  if (handlers.onOpenHistory) {
    items.push({ type: "separator" });
    items.push({
      label: "Show branch history",
      icon: GitBranch,
      onSelect: handlers.onOpenHistory,
    });
  }
  return items;
}
