<script lang="ts">
import type { Snippet } from "svelte";
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";
import type { MenuIcon } from "./context-menu-list.svelte";

let {
  label,
  icon,
  shortcut,
  disabled = false,
  destructive = false,
  onSelect,
  class: className,
  children,
}: {
  label: string;
  icon?: MenuIcon;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
  class?: string;
  children?: Snippet;
} = $props();
</script>

<ContextMenu.Item
  variant={destructive ? "destructive" : "default"}
  {disabled}
  {onSelect}
  class={className}
>
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
</ContextMenu.Item>
