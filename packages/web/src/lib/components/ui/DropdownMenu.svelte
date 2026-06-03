<script lang="ts">
  import type { Snippet } from "svelte";
  import { DropdownMenu as MenuPrimitive } from "bits-ui";
  import Check from "lucide-svelte/icons/check";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import { cn } from "../../utils/cn";

  export type MenuItem = {
    value: string;
    label: string;
    detail?: string;
    disabled?: boolean;
    checked?: boolean;
    tone?: "normal" | "danger";
  };

  type Props = {
    children?: Snippet;
    items?: MenuItem[];
    label?: string;
    ariaLabel?: string;
    class?: string;
    triggerClass?: string;
    align?: "start" | "center" | "end";
    onSelect?: (value: string) => void;
  };

  let {
    children,
    items = [],
    label = "Menu",
    ariaLabel,
    class: className = "",
    triggerClass = "",
    align = "end",
    onSelect,
  }: Props = $props();
</script>

<MenuPrimitive.Root>
  <MenuPrimitive.Trigger class={cn("menu-trigger", triggerClass)} aria-label={ariaLabel ?? label}>
    {#if children}
      {@render children()}
    {:else}
      <span>{label}</span>
      <ChevronDown size={13} aria-hidden="true" />
    {/if}
  </MenuPrimitive.Trigger>
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content class={cn("menu-content", className)} {align} sideOffset={5} collisionPadding={8}>
      {#each items as item}
        <MenuPrimitive.Item
          class="menu-item"
          data-tone={item.tone}
          disabled={item.disabled}
          textValue={item.label}
          onSelect={() => onSelect?.(item.value)}
        >
          <span class="item-check" aria-hidden="true">{#if item.checked}<Check size={13} strokeWidth={2.5} />{/if}</span>
          <span class="item-copy">
            <span>{item.label}</span>
            {#if item.detail}<small>{item.detail}</small>{/if}
          </span>
        </MenuPrimitive.Item>
      {/each}
    </MenuPrimitive.Content>
  </MenuPrimitive.Portal>
</MenuPrimitive.Root>

<style>
  :global(.menu-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    height: var(--control-height-sm);
    border: 1px solid hsl(var(--border) / 0.6);
    border-radius: var(--radius-sm);
    background: hsl(var(--input));
    color: hsl(var(--muted-foreground));
    padding: 0 0.45rem;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  :global(.menu-trigger:hover),
  :global(.menu-trigger[data-state="open"]) {
    border-color: hsl(var(--border));
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  :global(.menu-content) {
    z-index: 70;
    min-width: 11rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-md);
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    box-shadow: var(--shadow-popover);
    padding: 0.25rem;
  }

  :global(.menu-item) {
    display: grid;
    grid-template-columns: 1rem minmax(0, 1fr);
    align-items: center;
    gap: 0.35rem;
    min-height: 1.85rem;
    border-radius: var(--radius-sm);
    color: hsl(var(--foreground));
    padding: 0.28rem 0.45rem;
    font-size: var(--text-xs);
    outline: none;
    cursor: pointer;
  }

  :global(.menu-item[data-highlighted]),
  :global(.menu-item:hover) {
    background: hsl(var(--accent));
  }

  :global(.menu-item[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  :global(.menu-item[data-tone="danger"]) {
    color: hsl(var(--destructive));
  }

  .item-check {
    display: inline-grid;
    width: 1rem;
    place-items: center;
    color: hsl(var(--primary));
  }

  .item-copy {
    display: grid;
    min-width: 0;
    gap: 0.05rem;
  }

  .item-copy span,
  .item-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-copy small {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-2xs);
  }
</style>
