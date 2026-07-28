<script lang="ts">
import type { Component, Snippet } from "svelte";
import * as Empty from "@nervekit/ui-kit/components/ui/empty";

let {
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: Component;
  title: string;
  description?: string;
  action?: Snippet;
} = $props();
</script>

<Empty.Root class="gap-2 py-6">
  {#if Icon}
    <Empty.Media variant="icon" class="size-8 rounded-md">
      <Icon class="size-4" aria-hidden="true" />
    </Empty.Media>
  {/if}
  <Empty.Header class="gap-1">
    <Empty.Title class="text-sm font-medium">{title}</Empty.Title>
    {#if description}
      <Empty.Description class="text-xs">{description}</Empty.Description>
    {/if}
  </Empty.Header>
  {#if action}
    <Empty.Content class="gap-1">{@render action()}</Empty.Content>
  {/if}
</Empty.Root>
