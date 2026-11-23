<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import type { MenuIcon } from "./context-menu-list.svelte";

let {
  label,
  icon,
  shortcut,
  checked,
  disabled = false,
  destructive = false,
  onSelect,
  class: className,
  children,
}: {
  label: string;
  icon?: MenuIcon;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
  class?: string;
  children?: Snippet;
} = $props();
</script>

{#snippet content()}
  <span class="grid w-4 shrink-0 place-items-center">
    {#if icon}
      {@const Icon = icon}
      <Icon class="size-3.5" aria-hidden="true" />
    {/if}
  </span>
  <span class="truncate">{label}</span>
  {#if shortcut}
    <ContextMenu.Shortcut>{shortcut}</ContextMenu.Shortcut>
  {/if}
  {@render children?.()}
{/snippet}

{#if checked === undefined}
  <ContextMenu.Item
    variant={destructive ? "destructive" : "default"}
    {disabled}
    {onSelect}
    class={className}
  >
    {@render content()}
  </ContextMenu.Item>
{:else}
  <!-- A toggle: the check mark is the checkbox item's indicator. -->
  <ContextMenu.CheckboxItem
    {checked}
    {disabled}
    {onSelect}
    class={cn(destructive && "text-destructive", className)}
  >
    {@render content()}
  </ContextMenu.CheckboxItem>
{/if}
