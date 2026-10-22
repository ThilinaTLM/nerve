<!-- A change inside an `EntityCard`: muted label, foreground value, actions at the end. -->
<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import X from "@lucide/svelte/icons/x";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import type { Snippet } from "svelte";

type Props = {
  label: string;
  value: string;
  /** Inline after the value: mode indicator, lock icon, badges. */
  trailing?: Snippet;
  /** Under the value: options such as the lock checkbox. */
  detail?: Snippet;
  editLabel?: string;
  removeLabel?: string;
  onEdit?: () => void;
  onRemove?: () => void;
};

let {
  label,
  value,
  trailing,
  detail,
  editLabel = "Edit",
  removeLabel = "Remove",
  onEdit,
  onRemove,
}: Props = $props();
</script>

<div
  class="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5"
>
  <span class="text-xs text-muted-foreground">{label}</span>
  <span class="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
    <span class="truncate">{value}</span>
    {#if trailing}{@render trailing()}{/if}
  </span>
  <span class="flex justify-end gap-0.5">
    {#if onEdit}<IconAction
        icon={Pencil}
        label={editLabel}
        onclick={onEdit}
      />{/if}
    {#if onRemove}<IconAction
        icon={X}
        label={removeLabel}
        onclick={onRemove}
      />{/if}
  </span>
  {#if detail}<div class="col-start-2 col-end-4 pt-0.5">
      {@render detail()}
    </div>{/if}
</div>
