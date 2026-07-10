<script lang="ts" module>
// @lucide/svelte icons are Svelte components; keep the icon slot loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Icon component interop.
export type MenuIcon = any;

export type ContextMenuItem =
  | {
      type?: "item";
      label: string;
      icon?: MenuIcon;
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      onSelect?: () => void;
    }
  | { type: "separator" }
  | { type: "label"; label: string }
  | {
      type: "submenu";
      label: string;
      icon?: MenuIcon;
      disabled?: boolean;
      items: ContextMenuItem[];
    };
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import * as ContextMenu from "@nervekit/workbench-ui/components/ui/context-menu";

let {
  children,
  items,
  class: className,
  triggerClass,
  onOpenChange,
}: {
  children: Snippet;
  items: ContextMenuItem[];
  class?: string;
  triggerClass?: string;
  onOpenChange?: (open: boolean) => void;
} = $props();
</script>

{#snippet renderItems(list: ContextMenuItem[])}
  {#each list as item, index (index)}
    {#if item.type === "separator"}
      <ContextMenu.Separator />
    {:else if item.type === "label"}
      <ContextMenu.Group>
        <ContextMenu.GroupHeading>{item.label}</ContextMenu.GroupHeading>
      </ContextMenu.Group>
    {:else if item.type === "submenu"}
      {@const SubIcon = item.icon}
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger disabled={item.disabled}>
          {#if SubIcon}<SubIcon />{/if}
          <span class="truncate">{item.label}</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.SubContent>
          {@render renderItems(item.items)}
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    {:else}
      {@const Icon = item.icon}
      <ContextMenu.Item
        variant={item.destructive ? "destructive" : "default"}
        disabled={item.disabled}
        onSelect={item.onSelect}
      >
        {#if Icon}<Icon />{/if}
        <span class="truncate">{item.label}</span>
        {#if item.shortcut}
          <ContextMenu.Shortcut>{item.shortcut}</ContextMenu.Shortcut>
        {/if}
      </ContextMenu.Item>
    {/if}
  {/each}
{/snippet}

<ContextMenu.Root {onOpenChange}>
  <ContextMenu.Trigger class={triggerClass}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class={className}>
    {@render renderItems(items)}
  </ContextMenu.Content>
</ContextMenu.Root>
