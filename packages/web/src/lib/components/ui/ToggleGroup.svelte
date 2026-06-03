<script lang="ts">
  import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  export type ToggleItem = {
    value: string;
    label: string;
    detail?: string;
    disabled?: boolean;
  };

  type Props = {
    items?: ToggleItem[];
    value?: string;
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    onValueChange?: (value: string) => void;
  };

  let {
    items = [],
    value = $bindable(""),
    ariaLabel,
    disabled = false,
    class: className = "",
    onValueChange,
  }: Props = $props();

  function handleValueChange(next: string) {
    if (!next) return;
    value = next;
    onValueChange?.(next);
  }
</script>

<ToggleGroupPrimitive.Root
  class={cn("ui-toggle-group", className)}
  type="single"
  bind:value
  {disabled}
  aria-label={ariaLabel}
  onValueChange={handleValueChange}
>
  {#each items as item}
    <ToggleGroupPrimitive.Item class="toggle-item" value={item.value} disabled={item.disabled} aria-label={item.label} title={item.detail}>
      <span>{item.label}</span>
    </ToggleGroupPrimitive.Item>
  {/each}
</ToggleGroupPrimitive.Root>

<style>
  :global(.ui-toggle-group) {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    gap: 0;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-sm);
    background: hsl(var(--input));
    padding: 0;
    overflow: hidden;
  }

  :global(.toggle-item) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--control-height-sm);
    border: 0;
    border-right: 1px solid hsl(var(--border) / 0.6);
    border-radius: 0;
    background: transparent;
    color: hsl(var(--muted-foreground));
    padding: 0.18rem 0.58rem;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: 1;
    cursor: pointer;
    transition:
      background 110ms ease,
      color 110ms ease,
      opacity 110ms ease;
  }

  :global(.toggle-item:last-child) {
    border-right: 0;
  }

  :global(.toggle-item:hover:not([data-disabled])) {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  :global(.toggle-item[data-state="on"]) {
    background: hsl(var(--accent));
    color: hsl(var(--primary));
    box-shadow: inset 0 2px 0 hsl(var(--primary));
  }

  :global(.toggle-item:focus-visible) {
    outline: 1px solid hsl(var(--ring));
    outline-offset: -1px;
  }

  :global(.toggle-item[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
