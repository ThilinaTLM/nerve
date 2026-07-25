import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Clipboard from "@lucide/svelte/icons/clipboard";
import Copy from "@lucide/svelte/icons/copy";
import GitBranch from "@lucide/svelte/icons/git-branch";
import Pencil from "@lucide/svelte/icons/pencil";
import TextQuote from "@lucide/svelte/icons/text-quote";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/ui/context-menu-list";
import type { TranscriptMenuTarget } from "@nervekit/workbench-ui/components/conversation";
import {
  transcriptMenuModel,
  type ConversationMenuHandlers,
} from "./conversation-menu-model";
import type { ConversationEntry } from "$lib/api";

export type { ConversationMenuHandlers } from "./conversation-menu-model";

const icons = {
  "Copy selection": Copy,
  "Copy content": Clipboard,
  Quote: TextQuote,
  "Edit message": Pencil,
  "Edit prompt": Pencil,
  Discard: Trash2,
  "Continue from here": ArrowRight,
  "Copy ID": Copy,
  "Branch history": GitBranch,
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
  selectedText: string | undefined,
  context: ConversationMenuHandlers & {
    treeEntriesById: Map<string, ConversationEntry>;
  },
): ContextMenuItem[] {
  return addIcons(transcriptMenuModel(target, selectedText, context));
}
