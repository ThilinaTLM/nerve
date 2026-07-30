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
  badges?: Snippet;
  meta?: Snippet;
  actions?: Snippet;
  detail: Snippet;
};

let {
  title,
  description,
  open = $bindable(false),
  class: className,
  leading,
  badges,
  meta,
  actions,
  detail,
}: Props = $props();
</script>

<Collapsible.Root bind:open class={cn("min-w-0", className)}>
  <SettingsListItem {leading} {badges} {meta} {actions}>
    {#snippet content()}
      <Collapsible.Trigger
        class="group/disclosure flex min-w-0 flex-1 items-center gap-2 rounded-sm py-0.5"
      >
        <ChevronRight
          class="size-3.5 flex-none text-muted-foreground transition-transform group-data-[state=open]/disclosure:rotate-90"
          aria-hidden="true"
        />
        <span class="grid min-w-0 gap-0.5">
          <span class="truncate text-sm text-foreground">{title}</span>
          {#if description}
            <span class="line-clamp-1 text-xs text-muted-foreground"
              >{description}</span
            >
          {/if}
        </span>
      </Collapsible.Trigger>
    {/snippet}
  </SettingsListItem>

  <Collapsible.Content
    class="grid gap-2 px-3 pt-0 pb-3 pl-8 text-xs text-muted-foreground"
  >
    {@render detail()}
  </Collapsible.Content>
</Collapsible.Root>
