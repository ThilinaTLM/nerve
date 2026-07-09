import { Copy } from "@lucide/svelte";
import type { ContextMenuItem } from "@nervekit/shared-ui/components/ui/context-menu-list";
import { notifyCopyResult } from "@nervekit/shared-ui/core/notify";
import type {
  ToolCallTranscriptRecord,
  TranscriptItem,
} from "@nervekit/shared-ui/state";

async function copyText(text: string, label: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notifyCopyResult(true, label);
  } catch {
    notifyCopyResult(false, label);
  }
}

/** Minimal message context menu: copy the rendered message text. */
export function sandboxMessageMenu(item: TranscriptItem): ContextMenuItem[] {
  if (!item.text) return [];
  return [
    {
      label: "Copy message",
      icon: Copy,
      onSelect: () => void copyText(item.text, "message"),
    },
  ];
}

/** Minimal tool context menu: copy the tool-call id. */
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
