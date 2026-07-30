<script lang="ts">
import type { Component, Snippet } from "svelte";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";
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

<Empty.Root class={cn("border border-border/60 p-6", className)}>
  <Empty.Header>
    {#if Icon}
      <Empty.Media variant="icon">
        <Icon class="size-5 text-muted-foreground" aria-hidden="true" />
      </Empty.Media>
    {/if}
    <Empty.Title class="text-sm">{title}</Empty.Title>
    {#if description}
      <Empty.Description class="text-xs">{description}</Empty.Description>
    {/if}
  </Empty.Header>
  {#if actions}
    <Empty.Content class="flex-row items-center gap-2">
      {@render actions()}
    </Empty.Content>
  {/if}
</Empty.Root>
