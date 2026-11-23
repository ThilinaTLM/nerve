<!--
  A menu an extension frame asked the host to draw (`ui.menu`): the frame's entries as a ui-kit
  menu, opened against the anchor in app-window coordinates so it can leave the frame's rectangle.
  The first line names the extension, with its icon like pickers do. Choosing an item settles with its id; Escape, a click
  anywhere else and losing the menu settle with `null`.
-->
<script lang="ts">
import type { BridgeMenuEntry } from "@nervekit/contracts/extensions";
import ContextMenuList, {
  type AnchorRect,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import {
  extensionIcon,
  type ExtensionIconComponent,
} from "../model/extension-icons";
import { menuItemsOf, menuIconNames } from "../model/host-overlay";
import { resolveMenuIcons } from "../model/menu-icon-loader";

let {
  extensionName,
  extensionIconName,
  entries,
  anchor,
  onSettle,
}: {
  extensionName: string;
  /** The extension's own icon (a lucide name), when it has one. */
  extensionIconName?: string;
  entries: BridgeMenuEntry[];
  anchor: { getBoundingClientRect(): AnchorRect };
  onSettle: (id: string | null) => void;
} = $props();

let open = $state(true);
let icons = $state<ReadonlyMap<string, ExtensionIconComponent>>(new Map());

$effect(() => {
  let current = true;
  void resolveMenuIcons(menuIconNames(entries)).then((resolved) => {
    if (current) icons = resolved;
  });
  return () => {
    current = false;
  };
});

const items = $derived(
  menuItemsOf(entries, {
    extensionName,
    icons,
    extensionIcon: extensionIcon(extensionIconName),
    onChoose: onSettle,
  }),
);
</script>

<!-- A click inside the frame never reaches this document, so a layer over the app catches it. -->
<div
  class="fixed inset-0 z-[60]"
  role="presentation"
  onpointerdown={() => onSettle(null)}
></div>
<ContextMenuList
  bind:open
  {items}
  {anchor}
  onOpenChange={(next) => {
    if (!next) onSettle(null);
  }}
/>
