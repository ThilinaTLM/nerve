<!--
  A choice list an extension frame asked the host to draw (`ui.pick`): a ui-kit popover anchored
  in app-window coordinates (a bottom sheet on a phone), headed by the extension's name and icon.
  `single` settles with the chosen id at once; `multiple` toggles rows and settles with every
  chosen id on Apply or Enter. Escape, Cancel and a click anywhere else settle with `null`.
-->
<script lang="ts">
import { untrack } from "svelte";
import type { BridgeParams } from "@nervekit/contracts/extensions";
import PopoverPanel, {
  PopoverCommandList,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import type { AnchorRect } from "@nervekit/ui-kit/components/composites/context-menu-list";
import {
  extensionIcon,
  type ExtensionIconComponent,
} from "../model/extension-icons";
import {
  pickRowsOf,
  pickSearchThreshold,
  type PickRow,
} from "../model/host-overlay";
import { resolveMenuIcons } from "../model/menu-icon-loader";

let {
  extensionName,
  extensionIconName,
  params,
  anchor,
  onSettle,
}: {
  extensionName: string;
  /** The extension's own icon (a lucide name), when it has one. */
  extensionIconName?: string;
  params: BridgeParams<"ui.pick">;
  anchor: { getBoundingClientRect(): AnchorRect };
  onSettle: (ids: string[] | null) => void;
} = $props();

const multiple = $derived(params.mode === "multiple");
const rows = $derived(pickRowsOf(params.items));
const HeaderIcon = $derived(extensionIcon(extensionIconName));

let open = $state(true);
let query = $state("");
let selected = $state<string[]>(untrack(() => [...(params.selected ?? [])]));
let icons = $state<ReadonlyMap<string, ExtensionIconComponent>>(new Map());

$effect(() => {
  let current = true;
  void resolveMenuIcons(
    params.items.flatMap((item) => (item.icon ? [item.icon] : [])),
  ).then((resolved) => {
    if (current) icons = resolved;
  });
  return () => {
    current = false;
  };
});

function choose(row: PickRow): void {
  if (!multiple) {
    onSettle([row.key]);
    return;
  }
  selected = selected.includes(row.key)
    ? selected.filter((key) => key !== row.key)
    : [...selected, row.key];
}

function apply(): void {
  // In the order of the list, not of the clicks.
  onSettle(
    rows.filter((row) => selected.includes(row.key)).map((row) => row.key),
  );
}
</script>

<!-- A click inside the frame never reaches this document, so a layer over the app catches it. -->
<div
  class="fixed inset-0 z-[60]"
  role="presentation"
  onpointerdown={() => onSettle(null)}
></div>
<PopoverPanel
  bind:open
  {anchor}
  ariaLabel={`${params.ariaLabel}, from ${extensionName}`}
  presentation="adaptive"
  side="bottom"
  align="start"
  onOpenChange={(next) => {
    if (!next) onSettle(null);
  }}
>
  <PopoverHeader
    title={params.title ?? extensionName}
    meta={params.title ? extensionName : undefined}
  >
    {#snippet actions()}
      <HeaderIcon class="size-3.5 text-muted-foreground" aria-hidden="true" />
    {/snippet}
  </PopoverHeader>
  <PopoverCommandList
    items={rows}
    bind:query
    ariaLabel={params.ariaLabel}
    placeholder={params.placeholder ?? "Search"}
    searchable={rows.length > pickSearchThreshold}
    {multiple}
    isSelected={(row) => selected.includes(row.key)}
    isDisabled={(row) => row.disabled}
    onChoose={choose}
    onApply={apply}
    onCancel={() => onSettle(null)}
  >
    {#snippet icon(row)}
      {@const Icon = row.icon ? icons.get(row.icon) : undefined}
      {#if Icon}<Icon class="size-3.5" aria-hidden="true" />{/if}
    {/snippet}
  </PopoverCommandList>
</PopoverPanel>
