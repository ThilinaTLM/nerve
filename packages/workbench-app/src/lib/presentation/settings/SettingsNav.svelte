<!--
  Grouped settings navigation. Group titles are quiet captions (no hover, no
  icon); items are the interactive text, so icons and weight carry the
  hierarchy. The active item uses `bg-selected`: `muted`/`accent` are darker
  than `panel` in dark themes and would disappear. In a narrow settings pane
  (`settings-page` container) the groups flow into one scrollable row.
-->
<script lang="ts">
import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { cn } from "@nervekit/ui-kit/utils";
import type {
  SettingsNavGroup,
  SettingsScopeHeader,
} from "./settings-component-contracts";

type Props = {
  groups: SettingsNavGroup[];
  activeId: string;
  ariaLabel?: string;
  /** Identity above the nav: "User settings", or a project name. */
  header?: SettingsScopeHeader;
  onSelect: (id: string) => void;
};

let {
  groups,
  activeId,
  ariaLabel = "Settings pages",
  header,
  onSelect,
}: Props = $props();
</script>

{#if header}
  <div
    class="grid flex-none gap-0.5 border-b px-2 pb-2 @max-[46rem]/settings-page:border-b-0 @max-[46rem]/settings-page:pb-1"
  >
    <p class="text-sm font-semibold text-foreground">{header.title}</p>
    {#if header.subtitle}
      <p class="truncate text-xs text-muted-foreground">{header.subtitle}</p>
    {/if}
    {#if header.action}
      <Button
        variant="link"
        size="sm"
        class="-mx-1.5 justify-start"
        title={header.action.title}
        onclick={header.action.onSelect}
      >
        {header.action.label}
        <ArrowUpRight class="size-3.5" aria-hidden="true" />
      </Button>
    {/if}
  </div>
{/if}

<nav
  aria-label={ariaLabel}
  class="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pt-0 @max-[46rem]/settings-page:flex @max-[46rem]/settings-page:gap-1 @max-[46rem]/settings-page:overflow-x-auto @max-[46rem]/settings-page:pt-0"
>
  {#each groups as group (group.id)}
    <div class="grid gap-0.5 @max-[46rem]/settings-page:flex">
      {#if group.title}
        <p
          class="px-2 pb-0.5 text-xs font-medium text-muted-foreground @max-[46rem]/settings-page:hidden"
        >
          {group.title}
        </p>
      {/if}
      {#each group.items as item (item.id)}
        {@const Icon = item.icon}
        {@const current = activeId === item.id}
        <button
          type="button"
          disabled={item.disabled}
          aria-current={current ? "page" : undefined}
          class={cn(
            "group/nav flex w-full min-w-0 cursor-pointer items-center gap-2 h-control rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 @max-[46rem]/settings-page:w-auto @max-[46rem]/settings-page:flex-none",
            current && "bg-selected font-medium hover:bg-selected",
          )}
          onclick={() => onSelect(item.id)}
        >
          <Icon
            class={cn(
              "size-4 flex-none text-muted-foreground group-hover/nav:text-foreground",
              current && "text-foreground",
            )}
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">{item.label}</span>
          {#if item.badge}
            <Badge variant={item.badge.tone}>{item.badge.text}</Badge>
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</nav>
