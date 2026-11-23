<script lang="ts">
/* global MouseEvent, HTMLElement, console -- a frame component runs in the browser */
// Item-menu renderer of frames: the UI kit's panel rows, trees and cards open their context
// menu through it, and the host draws the menu (`host.ui.showMenu`) outside the frame.
import {
  flattenMenuItems,
  type ItemMenuRendererProps,
} from "@nervekit/ui-kit/components/composites/item-menu";
import { host } from "@nervekit/extension-sdk/ui";

let {
  items,
  disabled = false,
  triggerClass,
  onOpenChange,
  children,
}: ItemMenuRendererProps = $props();

// The host draws at most 32 entries, each with a 1–200 character label.
const MAX_ENTRIES = 32;

async function open(event: MouseEvent) {
  // A nested item (a row inside a card) already opened its own menu.
  if (disabled || event.defaultPrevented) return;
  const entries = flattenMenuItems(items)
    .filter((entry) => entry.label.trim() !== "")
    .slice(0, MAX_ENTRIES);
  if (entries.length === 0) return;
  event.preventDefault();
  // A keyboard-opened menu (context-menu key, Shift+F10) has no pointer position.
  let { clientX: x, clientY: y } = event;
  if (x === 0 && y === 0 && event.target instanceof HTMLElement) {
    const rect = event.target.getBoundingClientRect();
    x = rect.left;
    y = rect.bottom;
  }
  onOpenChange?.(true);
  try {
    const id = await host.ui.showMenu(
      entries.map((entry, index) => ({
        id: String(index),
        label: entry.label.slice(0, 200),
        disabled: entry.disabled,
        destructive: entry.destructive,
      })),
      { x, y },
    );
    if (id !== null) entries[Number(id)]?.onSelect?.();
  } catch (error) {
    console.error("Could not open the menu", error);
  } finally {
    onOpenChange?.(false);
  }
}
</script>

<div class={triggerClass} role="presentation" oncontextmenu={open}>
  {@render children()}
</div>
