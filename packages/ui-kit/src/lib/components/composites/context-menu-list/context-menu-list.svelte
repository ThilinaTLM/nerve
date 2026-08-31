<script lang="ts" module>
// @lucide/svelte icons are Svelte components; keep the icon slot loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Icon component interop.
export type MenuIcon = any;

export type ContextMenuItem =
  | {
      type?: "item";
      label: string;
      icon?: MenuIcon;
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      onSelect?: () => void;
    }
  | { type: "separator" }
  | { type: "label"; label: string }
  | {
      type: "submenu";
      label: string;
      icon?: MenuIcon;
      disabled?: boolean;
      items: ContextMenuItem[];
    };
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import ContextMenuListItems from "./context-menu-list-items.svelte";

let {
  children,
  items,
  class: className,
  triggerClass,
  disabled = false,
  onOpenChange,
}: {
  children: Snippet;
  items: ContextMenuItem[];
  class?: string;
  triggerClass?: string;
  /** Keep the trigger mounted but inert (e.g. while no actions exist yet). */
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
} = $props();

function assertNoEllipsis(list: ContextMenuItem[]): void {
  if (!import.meta.env.DEV) return;
  for (const item of list) {
    if (item.type === "separator") continue;
    if (item.type === "label") {
      checkLabel(item.label);
      continue;
    }
    if (item.type === "submenu") {
      checkLabel(item.label);
      assertNoEllipsis(item.items);
      continue;
    }
    checkLabel(item.label);
  }
}

function checkLabel(label: string): void {
  if (label.includes("…") || label.includes("...")) {
    console.warn(`Context menu label must not contain an ellipsis: "${label}"`);
  }
}

$effect(() => assertNoEllipsis(items));
</script>

<ContextMenu.Root {onOpenChange}>
  <ContextMenu.Trigger class={triggerClass} {disabled}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class={className}>
    <ContextMenuListItems {items} />
  </ContextMenu.Content>
</ContextMenu.Root>
