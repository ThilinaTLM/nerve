<script lang="ts" module>
  // lucide-svelte 1.x icons are legacy class components, not Svelte 5 functional
  // components, so keep the icon slot loosely typed.
  // biome-ignore lint/suspicious/noExplicitAny: icon component interop
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
  import { ContextMenu } from "bits-ui";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import { cn } from "../../utils/cn";

  type Props = {
    children: Snippet;
    items: ContextMenuItem[];
    class?: string;
    triggerClass?: string;
    onOpenChange?: (open: boolean) => void;
  };

  let { children, items, class: className = "", triggerClass = "", onOpenChange }: Props = $props();

  const contentClass =
    "z-50 min-w-[11rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-popover)] focus-visible:outline-none";
  const itemClass =
    "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-popover-foreground outline-none cursor-default select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 data-[disabled]:pointer-events-none";
  const dangerClass =
    "text-destructive data-[highlighted]:bg-destructive/15 data-[highlighted]:text-destructive";
</script>

{#snippet renderItems(list: ContextMenuItem[])}
  {#each list as item, index (index)}
    {#if item.type === "separator"}
      <ContextMenu.Separator class="-mx-1 my-1 block h-px bg-border" />
    {:else if item.type === "label"}
      <ContextMenu.Group>
        <ContextMenu.GroupHeading
          class="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {item.label}
        </ContextMenu.GroupHeading>
      </ContextMenu.Group>
    {:else if item.type === "submenu"}
      {@const SubIcon = item.icon}
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger class={cn(itemClass, "data-[state=open]:bg-accent")} disabled={item.disabled}>
          {#if SubIcon}<SubIcon size={15} strokeWidth={2} class="text-muted-foreground" />{/if}
          <span class="truncate">{item.label}</span>
          <ChevronRight size={14} strokeWidth={2} class="ml-auto text-muted-foreground" />
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent class={contentClass} sideOffset={6}>
            {@render renderItems(item.items)}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
    {:else}
      {@const Icon = item.icon}
      <ContextMenu.Item
        class={cn(itemClass, item.destructive && dangerClass)}
        disabled={item.disabled}
        onSelect={item.onSelect}
      >
        {#if Icon}<Icon size={15} strokeWidth={2} class={item.destructive ? "" : "text-muted-foreground"} />{/if}
        <span class="truncate">{item.label}</span>
        {#if item.shortcut}
          <span class="ml-auto pl-3 text-[11px] tracking-wide text-muted-foreground">{item.shortcut}</span>
        {/if}
      </ContextMenu.Item>
    {/if}
  {/each}
{/snippet}

<ContextMenu.Root {onOpenChange}>
  <ContextMenu.Trigger class={triggerClass}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class={cn(contentClass, className)} sideOffset={4}>
      {@render renderItems(items)}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
