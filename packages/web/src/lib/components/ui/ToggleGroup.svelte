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
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    padding: 0;
    overflow: hidden;
  }

  :global(.toggle-item) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--control-height-sm);
    border: 0;
    border-right: 1px solid var(--color-border-subtle);
    border-radius: 0;
    background: transparent;
    color: var(--color-muted);
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
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.toggle-item[data-state="on"]) {
    background: var(--color-accent-soft);
    color: var(--color-accent);
    box-shadow: inset 0 2px 0 var(--color-accent);
  }

  :global(.toggle-item:focus-visible) {
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }

  :global(.toggle-item[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
