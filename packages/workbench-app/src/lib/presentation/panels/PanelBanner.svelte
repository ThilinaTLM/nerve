<script lang="ts">
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { Component, Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

let {
  tone = "neutral",
  icon: Icon,
  actions,
  children,
}: {
  tone?: StatusTone;
  icon?: Component;
  actions?: Snippet;
  children: Snippet;
} = $props();

const toneClass = $derived(
  tone === "info"
    ? "bg-info-subtle text-info"
    : tone === "warning"
      ? "bg-warning-subtle text-warning"
      : tone === "destructive"
        ? "bg-destructive-subtle text-destructive"
        : "bg-muted text-muted-foreground",
);
</script>

<div class={cn("flex min-w-0 items-center gap-1.5 py-1 text-ui", toneClass)}>
  {#if Icon}
    <Icon class="size-3.5 shrink-0" aria-hidden="true" />
  {/if}
  <div class="min-w-0 flex-1">{@render children()}</div>
  {#if actions}
    <div class="flex shrink-0 items-center gap-0.5">{@render actions()}</div>
  {/if}
</div>
