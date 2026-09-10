<script lang="ts">
import type { Component, Snippet } from "svelte";

type Props = {
  icon?: Component;
  title: string;
  description?: string;
  unread?: boolean;
  subdued?: boolean;
  meta?: Snippet;
  actions?: Snippet;
};

let {
  icon: Icon,
  title,
  description,
  unread = false,
  subdued = false,
  meta,
  actions,
}: Props = $props();
</script>

<div class="flex items-center gap-3 px-3 py-2.5">
  {#if Icon}
    <div
      class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted {subdued
        ? 'text-muted-foreground'
        : 'text-foreground'}"
    >
      <Icon class="size-4" aria-hidden="true" />
    </div>
  {/if}
  <div class="grid min-w-0 flex-1 gap-0.5">
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      {#if unread}
        <span class="size-1.5 shrink-0 rounded-full bg-info" aria-hidden="true"
        ></span>
      {/if}
      <span
        class="truncate text-sm {subdued
          ? 'text-muted-foreground'
          : 'text-foreground'}"
      >
        {title}
      </span>
      {#if meta}
        {@render meta()}
      {/if}
    </div>
    {#if description}
      <p class="truncate text-xs text-muted-foreground">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex shrink-0 items-center gap-1">{@render actions()}</div>
  {/if}
</div>
