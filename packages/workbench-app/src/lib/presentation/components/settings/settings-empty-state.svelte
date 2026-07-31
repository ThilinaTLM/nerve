<script lang="ts">
import type { Component, Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  title: string;
  description?: string;
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  class?: string;
  actions?: Snippet;
};

let {
  title,
  description,
  icon: Icon,
  class: className,
  actions,
}: Props = $props();
</script>

<div
  class={cn(
    "flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-xs",
    className,
  )}
>
  {#if Icon}
    <Icon class="size-4 flex-none text-muted-foreground" aria-hidden="true" />
  {/if}
  <div class="grid min-w-0 flex-1 gap-0.5">
    <span class="text-sm text-foreground">{title}</span>
    {#if description}
      <span class="text-xs text-muted-foreground">{description}</span>
    {/if}
  </div>
  {#if actions}
    <div class="flex flex-none items-center gap-1.5">
      {@render actions()}
    </div>
  {/if}
</div>
