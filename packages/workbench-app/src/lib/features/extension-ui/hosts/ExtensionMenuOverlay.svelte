<!--
  A menu an extension frame asked the host to draw (`ui.menu`): the frame's entries as a ui-kit
  menu, opened against the anchor in app-window coordinates so it can leave the frame's rectangle.
  The first line names the extension. Choosing an item settles with its id; Escape, a click
  anywhere else and losing the menu settle with `null`.
-->
<script lang="ts">
import type { BridgeMenuEntry } from "@nervekit/contracts/extensions";
import ContextMenuList, {
  type AnchorRect,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ExtensionIconComponent } from "../model/extension-icons";
import { menuItemsOf, menuIconNames } from "../model/host-overlay";
import { resolveMenuIcons } from "../model/menu-icon-loader";

let {
  extensionName,
  entries,
  anchor,
  onSettle,
}: {
  extensionName: string;
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
  menuItemsOf(entries, { extensionName, icons, onChoose: onSettle }),
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
