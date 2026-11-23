<!--
@component
Sticky, always-open heading of a group of rows (a repository, a date). Use `PanelSection` when the user should collapse the group.
-->

<script lang="ts">
import type { Component, Snippet } from "svelte";

let {
  title,
  icon: Icon,
  count,
  meta,
  actions,
}: {
  /** Heading text. */
  title: string;
  /** Icon component before the title. */
  icon?: Component;
  /** Number of rows in the group. */
  count?: number;
  /** Muted text after the title. */
  meta?: Snippet;
  /** Icon actions at the end. */
  actions?: Snippet;
} = $props();
</script>

<div class="sticky top-0 z-1 flex h-7 items-center gap-1 bg-panel">
  <div class="flex min-w-0 flex-1 items-center gap-1">
    {#if Icon}
      <Icon class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    {/if}
    <span class="truncate text-ui font-medium text-foreground">{title}</span>
    {#if count !== undefined}
      <span class="shrink-0 text-ui text-muted-foreground">{count}</span>
    {/if}
  </div>
  {#if meta}
    <div class="flex shrink-0 items-center gap-1 text-ui text-muted-foreground">
      {@render meta()}
    </div>
  {/if}
  {#if actions}
    <div class="flex shrink-0 items-center gap-0.5">
      {@render actions()}
    </div>
  {/if}
</div>
