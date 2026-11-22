<script lang="ts">
/* global MouseEvent, HTMLElement -- a frame component runs in the browser */
import type { Component } from "svelte";
import { Ellipsis } from "@nervekit/extension-sdk/icons";
import {
  FloatingToolbarButton,
  host,
  type MenuItem,
} from "@nervekit/extension-sdk/ui";

type Props = {
  /** Entries of the menu. */
  items: MenuItem[];
  /** Called with the `id` of the chosen item; not called when the menu is dismissed. */
  onSelect: (id: string) => void;
  /** Tooltip and accessible name of the trigger. */
  label?: string;
  icon?: Component<{ class?: string; "aria-hidden"?: boolean | "true" }>;
};

let {
  items,
  onSelect,
  label = "More actions",
  icon = Ellipsis,
}: Props = $props();

// The host draws the menu outside the frame; it opens below the trigger's bottom-right corner.
async function open(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const id = await host.ui.showMenu(items, { x: rect.right, y: rect.bottom });
  if (id !== null) onSelect(id);
}
</script>

<FloatingToolbarButton {label} {icon} onclick={open} />
