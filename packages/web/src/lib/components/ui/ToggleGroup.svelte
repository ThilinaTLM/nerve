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
    gap: 0.15rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    padding: 0.15rem;
    box-shadow: var(--shadow-panel);
  }

  :global(.toggle-item) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--control-height-sm);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted);
    padding: 0.18rem 0.5rem;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    line-height: 1;
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      opacity 120ms ease;
  }

  :global(.toggle-item:hover:not([data-disabled])) {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.toggle-item[data-state="on"]) {
    border-color: var(--color-border);
    background: var(--color-accent-soft);
    color: var(--color-accent-strong);
  }

  :global(.toggle-item:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  :global(.toggle-item[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
