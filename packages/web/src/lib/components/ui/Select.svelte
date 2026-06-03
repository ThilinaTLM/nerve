<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import Check from "lucide-svelte/icons/check";
  import ChevronDown from "lucide-svelte/icons/chevron-down";
  import { cn } from "../../utils/cn";

  export type SelectItem = {
    value: string;
    label: string;
    detail?: string;
    disabled?: boolean;
  };

  type Props = {
    items?: SelectItem[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
    class?: string;
    triggerClass?: string;
    contentClass?: string;
    onValueChange?: (value: string) => void;
  };

  let {
    items = [],
    value = $bindable(""),
    placeholder = "Select…",
    disabled = false,
    ariaLabel,
    class: className = "",
    triggerClass = "",
    contentClass = "",
    onValueChange,
  }: Props = $props();

  function handleValueChange(next: string) {
    value = next;
    onValueChange?.(next);
  }
</script>

<div class={cn("ui-select", className)}>
  <SelectPrimitive.Root
    type="single"
    bind:value
    {items}
    {disabled}
    loop
    onValueChange={handleValueChange}
  >
    <SelectPrimitive.Trigger class={cn("select-trigger", triggerClass)} aria-label={ariaLabel}>
      <span class="select-value"><SelectPrimitive.Value {placeholder} /></span>
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content class={cn("select-content", contentClass)} sideOffset={5} collisionPadding={8}>
        <SelectPrimitive.Viewport class="select-viewport">
          {#each items as item}
            <SelectPrimitive.Item class="select-item" value={item.value} label={item.label} disabled={item.disabled}>
              <span class="item-copy">
                <span>{item.label}</span>
                {#if item.detail}<small>{item.detail}</small>{/if}
              </span>
              <Check class="select-item-check" size={13} strokeWidth={2.5} aria-hidden="true" />
            </SelectPrimitive.Item>
          {/each}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
</div>

<style>
  .ui-select {
    min-width: 0;
  }

  :global(.select-trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    width: 100%;
    min-width: 8rem;
    height: var(--control-height-sm);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-sm);
    background: hsl(var(--input));
    color: hsl(var(--foreground));
    padding: 0 0.55rem;
    font-size: var(--text-xs);
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 0 rgb(255 255 255 / 2%) inset;
    transition:
      border-color 110ms ease,
      background 110ms ease,
      box-shadow 110ms ease,
      opacity 110ms ease;
  }

  :global(.select-trigger:hover:not([data-disabled])) {
    border-color: hsl(var(--ring));
    background: hsl(var(--sidebar));
  }

  :global(.select-trigger[data-state="open"]),
  :global(.select-trigger:focus-visible) {
    border-color: hsl(var(--primary));
    box-shadow: 0 0 0 1px hsl(var(--ring) / 0.35);
    outline: none;
  }

  :global(.select-trigger[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .select-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.select-content) {
    z-index: 60;
    min-width: var(--bits-select-anchor-width, 12rem);
    max-height: min(20rem, var(--bits-select-content-available-height, 20rem));
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-md);
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    box-shadow: var(--shadow-popover);
    padding: 0.25rem;
  }

  :global(.select-viewport) {
    max-height: inherit;
    overflow: auto;
  }

  :global(.select-item) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    min-height: 2rem;
    border-radius: var(--radius-sm);
    color: hsl(var(--foreground));
    padding: 0.32rem 0.5rem;
    font-size: var(--text-xs);
    outline: none;
    cursor: pointer;
  }

  :global(.select-item[data-highlighted]) {
    background: hsl(var(--accent));
  }

  :global(.select-item[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  :global(.select-item:not([data-selected]) .select-item-check) {
    visibility: hidden;
  }

  .item-copy {
    display: grid;
    min-width: 0;
    gap: 0.06rem;
  }

  .item-copy span,
  .item-copy small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-copy small {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-2xs);
  }

  :global(.select-item-check) {
    flex: none;
    color: hsl(var(--primary));
  }
</style>
