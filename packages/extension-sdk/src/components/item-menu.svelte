<script lang="ts">
/* global MouseEvent, HTMLElement, console -- a frame component runs in the browser */
// Item-menu renderer of frames: the UI kit's panel rows, trees and cards open their context
// menu through it, and the host draws the menu (`host.ui.menu`) outside the frame.
import type { ItemMenuRendererProps } from "@nervekit/ui-kit/components/composites/item-menu";
import { host } from "@nervekit/extension-sdk/ui";
import type { MenuEntry } from "../frame/bridge-types.js";

let {
  items,
  disabled = false,
  triggerClass,
  onOpenChange,
  children,
}: ItemMenuRendererProps = $props();

type Items = ItemMenuRendererProps["items"];

// The whole tree goes to the host as it is. The bridge ids an item by its position (`0`, `2.1`),
// so the chosen id leads back to its action. A frame's icons are lucide names, not components.
function toEntries(
  list: Items,
  prefix: string,
  actions: Map<string, () => void>,
): MenuEntry[] {
  return list.map((entry, index): MenuEntry => {
    const icon = typeof entry.icon === "string" ? entry.icon : undefined;
    if (entry.type === "separator") return { type: "separator" };
    if (entry.type === "label") return { type: "label", label: entry.label };
    if (entry.type === "submenu")
      return {
        type: "submenu",
        label: entry.label,
        ...(icon ? { icon } : {}),
        ...(entry.disabled ? { disabled: true } : {}),
        items: toEntries(entry.items, `${prefix}${index}.`, actions),
      };
    const id = `${prefix}${index}`;
    if (entry.onSelect) actions.set(id, entry.onSelect);
    return {
      id,
      label: entry.label,
      ...(icon ? { icon } : {}),
      ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
      ...(entry.checked === undefined ? {} : { checked: entry.checked }),
      ...(entry.disabled ? { disabled: true } : {}),
      ...(entry.destructive ? { destructive: true } : {}),
    };
  });
}

async function open(event: MouseEvent) {
  // A nested item (a row inside a card) already opened its own menu.
  if (disabled || event.defaultPrevented || items.length === 0) return;
  event.preventDefault();
  // A keyboard-opened menu (context-menu key, Shift+F10) has no pointer position.
  let anchor = { x: event.clientX, y: event.clientY };
  if (anchor.x === 0 && anchor.y === 0 && event.target instanceof HTMLElement) {
    const rect = event.target.getBoundingClientRect();
    anchor = { x: rect.left, y: rect.bottom };
  }
  onOpenChange?.(true);
  try {
    const actions = new Map<string, () => void>();
    const entries = toEntries(items, "", actions);
    const id = await host.ui.menu(entries, { anchor });
    if (id !== null) actions.get(id)?.();
  } catch (error) {
    // An invalid or over-limit menu was logged by the host call; this covers the rest.
    console.error("Could not open the menu", error);
  } finally {
    onOpenChange?.(false);
  }
}
</script>

<div class={triggerClass} role="presentation" oncontextmenu={open}>
  {@render children()}
</div>
