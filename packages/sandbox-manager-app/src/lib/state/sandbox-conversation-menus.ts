import { Clipboard, Copy, TextQuote } from "@lucide/svelte";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import type {
  ToolCallTranscriptRecord,
  TranscriptItem,
} from "@nervekit/workbench-ui/state";

async function copyText(text: string, label: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notifyCopyResult(true, label);
  } catch {
    notifyCopyResult(false, label);
  }
}

export type SandboxMessageMenuHandlers = {
  /** Insert quoted message text into the active composer. */
  quoteInComposer?: (text: string) => void;
};

/**
 * Message context menu matching the workbench items that the sandbox protocol
 * supports (no conversation-tree branching operations).
 */
export function sandboxMessageMenu(
  item: TranscriptItem,
  handlers: SandboxMessageMenuHandlers = {},
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (item.text) {
    items.push({
      label: "Copy text",
      icon: Clipboard,
      onSelect: () => void copyText(item.text, "message"),
    });
    if (handlers.quoteInComposer) {
      const quote = handlers.quoteInComposer;
      items.push({
        label: "Quote in composer",
        icon: TextQuote,
        onSelect: () => quote(item.text),
      });
    }
  }
  if (item.id) {
    if (items.length > 0) items.push({ type: "separator" });
    items.push({
      label: "Copy message id",
      icon: Copy,
      onSelect: () => void copyText(item.id ?? "", "message id"),
    });
  }
  return items;
}

/** Tool context menu: copy the tool-call id. */
export function sandboxToolMenu(
  _anchorEntryId: string | undefined,
  toolCall: ToolCallTranscriptRecord,
): ContextMenuItem[] {
  return [
    {
      label: "Copy tool id",
      icon: Copy,
      onSelect: () => void copyText(toolCall.id, "tool id"),
    },
  ];
}
