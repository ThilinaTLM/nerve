<!--
@component
Overflow button of a `FloatingToolbar` for secondary actions: keep 4–8 controls on the bar and put the rest here. Opens a menu drawn by the host (`host.ui.menu`) below the button.
-->

<script lang="ts">
/* global MouseEvent, HTMLElement -- a frame component runs in the browser */
import type { Component } from "svelte";
import { Ellipsis } from "@lucide/svelte";
import { FloatingToolbarButton, host } from "@nervekit/extension-sdk/ui";
import type { MenuEntry } from "../frame/bridge-types.js";

type Props = {
  /** Entries of the menu: items, separators, captions and submenus. */
  items: MenuEntry[];
  /** Called with the `id` of the chosen item; not called when the menu is dismissed. */
  onSelect: (id: string) => void;
  /** Tooltip and accessible name of the trigger. */
  label?: string;
  /** Icon component of the trigger (default the ellipsis). */
  icon?: Component<{ class?: string; "aria-hidden"?: boolean | "true" }>;
};

let {
  items,
  onSelect,
  label = "More actions",
  icon = Ellipsis,
}: Props = $props();

// The host draws the menu outside the frame, below the trigger.
async function open(event: MouseEvent) {
  const anchor = event.currentTarget as HTMLElement;
  const id = await host.ui.menu(items, { anchor });
  if (id !== null) onSelect(id);
}
</script>

<FloatingToolbarButton {label} {icon} onclick={open} />
