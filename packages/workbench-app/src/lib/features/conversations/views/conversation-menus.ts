import Clipboard from "@lucide/svelte/icons/clipboard";
import Copy from "@lucide/svelte/icons/copy";
import History from "@lucide/svelte/icons/history";
import Pencil from "@lucide/svelte/icons/pencil";
import TextQuote from "@lucide/svelte/icons/text-quote";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Undo2 from "@lucide/svelte/icons/undo-2";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type {
  TranscriptMenuTarget,
  TranscriptSelection,
} from "$lib/presentation/conversations";
import {
  transcriptMenuModel,
  type ConversationMenuHandlers,
} from "./conversation-menu-model";

import type { ConversationEntry } from "$lib/presentation/view-models/conversation";

export type { ConversationMenuHandlers } from "./conversation-menu-model";

const icons = {
  "Copy selection": Copy,
  "Copy content": Clipboard,
  Quote: TextQuote,
  "Quote selection": TextQuote,
  "Edit message": Pencil,
  "Edit prompt": Pencil,
  Discard: Trash2,
  "Rewind to here": Undo2,
  "Copy ID": Copy,
  History,
} as const;

function addIcons(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.map((item) => {
    if (item.type === "separator" || item.type === "label") return item;
    if (item.type === "submenu") {
      return { ...item, items: addIcons(item.items) };
    }
    return {
      ...item,
      icon: icons[item.label as keyof typeof icons],
    };
  });
}

export function transcriptMenu(
  target: TranscriptMenuTarget,
  selection: TranscriptSelection | undefined,
  context: ConversationMenuHandlers & {
    treeEntriesById: Map<string, ConversationEntry>;
  },
): ContextMenuItem[] {
  return addIcons(transcriptMenuModel(target, selection, context));
}
