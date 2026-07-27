<script lang="ts">
import type { Component, Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";

let {
  tone = "muted",
  icon: Icon,
  actions,
  children,
}: {
  tone?: "info" | "warning" | "destructive" | "muted";
  icon?: Component;
  actions?: Snippet;
  children: Snippet;
} = $props();

const toneClass = $derived(
  tone === "info"
    ? "bg-info/10 text-info"
    : tone === "warning"
      ? "bg-warning/10 text-warning"
      : tone === "destructive"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted/50 text-muted-foreground",
);
</script>

<div
  class={cn("flex min-w-0 items-center gap-1.5 px-2 py-1 text-xs", toneClass)}
>
  {#if Icon}
    <Icon class="size-3.5 shrink-0" aria-hidden="true" />
  {/if}
  <div class="min-w-0 flex-1">{@render children()}</div>
  {#if actions}
    <div class="flex shrink-0 items-center gap-0.5">{@render actions()}</div>
  {/if}
</div>
