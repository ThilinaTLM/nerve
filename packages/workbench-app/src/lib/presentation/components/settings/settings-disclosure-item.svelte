<!--
  Expandable settings list row. The trigger keeps its title and description in
  both states (the description unclamps in place when open) so the row height
  stays stable and the chevron only rotates. The `detail` snippet is for
  supplemental content only (paths, nested lists, controls); never repeat the
  description there.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";
import { cn } from "@nervekit/ui-kit/core/utils";
import SettingsListItem from "./settings-list-item.svelte";

type Props = {
  title: string;
  description?: string;
  open?: boolean;
  class?: string;
  leading?: Snippet;
  titleSuffix?: Snippet;
  badges?: Snippet;
  meta?: Snippet;
  actions?: Snippet;
  detail: Snippet;
  variant?: "plain" | "card";
};

let {
  title,
  description,
  open = $bindable(false),
  class: className,
  leading,
  titleSuffix,
  badges,
  meta,
  actions,
  detail,
  variant = "plain",
}: Props = $props();
</script>

<Collapsible.Root
  bind:open
  class={cn(
    "min-w-0",
    variant === "card" &&
      "overflow-hidden rounded-md border border-transparent bg-accent/90 dark:bg-accent/60",
    className,
  )}
>
  <SettingsListItem
    {leading}
    {badges}
    {meta}
    {actions}
    class={variant === "card" ? "px-3" : undefined}
  >
    {#snippet content()}
      <Collapsible.Trigger
        class="group/disclosure flex min-w-0 flex-1 items-start gap-2 rounded-sm py-0.5"
      >
        <ChevronRight
          class="mt-[3px] size-3.5 flex-none text-muted-foreground transition-transform group-data-[state=open]/disclosure:rotate-90"
          aria-hidden="true"
        />
        <span class="grid min-w-0 gap-0.5 text-left">
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-sm text-foreground">{title}</span>
            {#if titleSuffix}
              {@render titleSuffix()}
            {/if}
          </span>
          {#if description}
            <span
              class={cn(
                "text-xs text-muted-foreground",
                !open && "line-clamp-1",
              )}>{description}</span
            >
          {/if}
        </span>
      </Collapsible.Trigger>
    {/snippet}
  </SettingsListItem>

  <Collapsible.Content
    class="grid gap-1.5 pt-0 pb-2 pl-5.5 text-xs text-muted-foreground"
  >
    {@render detail()}
  </Collapsible.Content>
</Collapsible.Root>
