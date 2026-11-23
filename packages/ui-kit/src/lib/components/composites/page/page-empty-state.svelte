<script lang="ts">
import type { Component, Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  /** What is empty. */
  title: string;
  /** What to do about it. */
  description?: string;
  /** Leading glyph (lucide icon). */
  icon?: Component<{ class?: string; "aria-hidden"?: "true" }>;
  /** `card` renders the bordered dashed empty-state box (e.g. inside provider lists). */
  variant?: "plain" | "card";
  class?: string;
  /** Call-to-action buttons at the right. */
  actions?: Snippet;
};

let {
  title,
  description,
  icon: Icon,
  variant = "plain",
  class: className,
  actions,
}: Props = $props();
</script>

<div
  class={cn(
    "flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-ui",
    // A divided section surface has no padding of its own (its rows pad
    // themselves), so the empty state pads like a row. Other surfaces already
    // pad their body, so it sits flush there.
    "group-data-page-divided/surface:min-h-14 group-data-page-divided/surface:px-3",
    variant === "card" &&
      "rounded-md border border-dashed bg-card px-3 py-2 group-data-page-surface/surface:border-0 group-data-page-surface/surface:bg-transparent group-not-data-page-divided/surface:group-data-page-surface/surface:px-0",
    className,
  )}
>
  {#if Icon}
    <Icon class="size-4 flex-none text-muted-foreground" aria-hidden="true" />
  {/if}
  <div class="grid min-w-0 flex-1 gap-0.5">
    <span class="text-ui text-foreground">{title}</span>
    {#if description}
      <span class="text-ui text-muted-foreground">{description}</span>
    {/if}
  </div>
  {#if actions}
    <div class="flex flex-none items-center gap-1.5">
      {@render actions()}
    </div>
  {/if}
</div>
