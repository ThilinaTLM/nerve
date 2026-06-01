<script lang="ts">
  import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  export type RadioItem = {
    value: string;
    label: string;
    detail?: string;
    disabled?: boolean;
  };

  type Props = {
    items?: RadioItem[];
    value?: string;
    orientation?: "horizontal" | "vertical";
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    onValueChange?: (value: string) => void;
  };

  let {
    items = [],
    value = $bindable(""),
    orientation = "vertical",
    ariaLabel,
    disabled = false,
    class: className = "",
    onValueChange,
  }: Props = $props();

  function handleValueChange(next: string) {
    value = next;
    onValueChange?.(next);
  }
</script>

<RadioGroupPrimitive.Root
  class={cn("ui-radio-group", orientation, className)}
  bind:value
  {orientation}
  {disabled}
  aria-label={ariaLabel}
  onValueChange={handleValueChange}
>
  {#each items as item}
    <RadioGroupPrimitive.Item class="radio-card" value={item.value} disabled={item.disabled} aria-label={item.label}>
      {#snippet children({ checked })}
        <span class="radio-indicator" data-checked={checked ? "" : undefined}></span>
        <span class="radio-copy">
          <span>{item.label}</span>
          {#if item.detail}<small>{item.detail}</small>{/if}
        </span>
      {/snippet}
    </RadioGroupPrimitive.Item>
  {/each}
</RadioGroupPrimitive.Root>

<style>
  :global(.ui-radio-group) {
    display: grid;
    min-width: 0;
    gap: 0.42rem;
  }

  :global(.ui-radio-group.horizontal) {
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  }

  :global(.radio-card) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 0.5rem;
    min-height: 3.1rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.55rem 0.62rem;
    text-align: left;
    cursor: pointer;
    box-shadow: var(--shadow-panel);
    transition:
      border-color 140ms ease,
      background 140ms ease,
      box-shadow 140ms ease,
      opacity 140ms ease;
  }

  :global(.radio-card:hover:not([data-disabled])) {
    border-color: var(--color-border);
    background: var(--color-panel-raised);
  }

  :global(.radio-card[data-state="checked"]) {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
    box-shadow: 0 0 0 1px var(--color-ring-soft);
  }

  :global(.radio-card:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  :global(.radio-card[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .radio-indicator {
    display: inline-grid;
    width: 0.86rem;
    height: 0.86rem;
    place-items: center;
    margin-top: 0.1rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-bg-deep);
  }

  .radio-indicator::after {
    content: "";
    width: 0.42rem;
    height: 0.42rem;
    border-radius: 999px;
    background: transparent;
  }

  .radio-indicator[data-checked] {
    border-color: var(--color-accent);
  }

  .radio-indicator[data-checked]::after {
    background: var(--color-accent);
  }

  .radio-copy {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .radio-copy span,
  .radio-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .radio-copy span {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
  }

  .radio-copy small {
    color: var(--color-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }
</style>
