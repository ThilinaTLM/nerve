<!--
  Grouped settings navigation. Group titles are quiet captions (no hover, no
  icon); items are the interactive text, so icons and weight carry the
  hierarchy. Items are `SelectRow`s: the active item takes the shared
  selection (`bg-selected`, medium label, brand icon). In a narrow settings pane
  (`settings-page` container) the groups flow into one scrollable row.
-->
<script lang="ts">
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { SelectRow } from "@nervekit/ui-kit/components/composites/select-row";
import type { SettingsNavGroup } from "./settings-component-contracts";

type Props = {
  groups: SettingsNavGroup[];
  activeId: string;
  ariaLabel?: string;
  onSelect: (id: string) => void;
};

// A small solid circle, so a count reads at a glance.
const NAV_BADGE =
  "h-4 min-w-4 justify-center rounded-full bg-warning px-1 text-caption leading-none font-semibold text-warning-foreground";

let {
  groups,
  activeId,
  ariaLabel = "Settings pages",
  onSelect,
}: Props = $props();
</script>

<nav
  aria-label={ariaLabel}
  class="-mx-1 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-1 pt-0 pb-1 @max-[46rem]/settings-page:flex @max-[46rem]/settings-page:gap-1 @max-[46rem]/settings-page:overflow-x-auto @max-[46rem]/settings-page:pt-0"
>
  {#each groups as group (group.id)}
    <div
      class="grid gap-0.5 @max-[46rem]/settings-page:flex @max-[46rem]/settings-page:flex-none"
    >
      {#if group.title}
        <GroupLabel
          class="px-2 pb-0.5 @max-[46rem]/settings-page:hidden"
          label={group.title}
        />
      {/if}
      {#each group.items as item (item.id)}
        {@const Icon = item.icon}
        {@const current = activeId === item.id}
        {#snippet icon()}<Icon
            class="size-4 flex-none"
            aria-hidden="true"
          />{/snippet}
        {#snippet badge()}{#if item.badge}<Badge
              variant={item.badge.tone}
              class={NAV_BADGE}>{item.badge.text}</Badge
            >{/if}{/snippet}
        <SelectRow
          label={item.label}
          {icon}
          trailing={item.badge ? badge : undefined}
          selected={current}
          current={current ? "page" : false}
          disabled={item.disabled}
          class="px-2 @max-[46rem]/settings-page:w-auto @max-[46rem]/settings-page:flex-none"
          onclick={() => onSelect(item.id)}
        />
      {/each}
    </div>
  {/each}
</nav>
