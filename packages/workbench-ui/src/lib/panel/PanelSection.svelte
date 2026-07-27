<script lang="ts">
import type { Component, Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/core/utils";
import PanelSectionHeader from "./PanelSectionHeader.svelte";

let {
  title,
  icon,
  count,
  open = $bindable(true),
  meta,
  actions,
  onOpenChange,
  contentClass,
  children,
}: {
  title: string;
  icon?: Component;
  count?: number;
  open?: boolean;
  meta?: Snippet;
  actions?: Snippet;
  onOpenChange?: (open: boolean) => void;
  contentClass?: string;
  children: Snippet;
} = $props();

function toggle(): void {
  open = !open;
  onOpenChange?.(open);
}
</script>

<section class="panel-section flex min-w-0 flex-col">
  <PanelSectionHeader
    {title}
    {icon}
    {count}
    {meta}
    {actions}
    {open}
    onToggle={toggle}
  />
  {#if open}
    <div class={cn("flex min-w-0 flex-col pb-1", contentClass)}>
      {@render children()}
    </div>
  {/if}
</section>
