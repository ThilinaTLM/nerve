<script lang="ts">
import type { Component } from "svelte";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";

let {
  label,
  icon: Icon,
  class: className,
}: {
  label: string;
  /** Icon component before the caption. */
  icon?: Component;
  class?: string;
} = $props();
</script>

<ContextMenu.Group>
  <ContextMenu.GroupHeading class={className}>
    {#if Icon}
      <span class="flex items-center gap-1.5">
        <Icon class="size-3.5" aria-hidden="true" />{label}
      </span>
    {:else}
      {label}
    {/if}
  </ContextMenu.GroupHeading>
</ContextMenu.Group>
