<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  export type TabItem = {
    value: string;
    label: string;
    count?: number;
    disabled?: boolean;
  };

  type Props = {
    tabs?: TabItem[];
    value?: string;
    ariaLabel?: string;
    class?: string;
    onValueChange?: (value: string) => void;
  };

  let { tabs = [], value = $bindable(""), ariaLabel, class: className = "", onValueChange }: Props = $props();

  function handleValueChange(next: string) {
    value = next;
    onValueChange?.(next);
  }
</script>

<TabsPrimitive.Root class={cn("ui-tabs", className)} bind:value activationMode="automatic" loop onValueChange={handleValueChange}>
  <TabsPrimitive.List class="tabs-list" aria-label={ariaLabel}>
    {#each tabs as tab}
      <TabsPrimitive.Trigger class="tabs-trigger" value={tab.value} disabled={tab.disabled}>
        <span>{tab.label}</span>
        {#if tab.count}<b>{tab.count}</b>{/if}
      </TabsPrimitive.Trigger>
    {/each}
  </TabsPrimitive.List>
</TabsPrimitive.Root>

<style>
  :global(.ui-tabs) {
    min-width: 0;
  }

  :global(.tabs-list) {
    display: flex;
    gap: 0;
    min-width: 0;
    overflow-x: auto;
    padding: 0;
  }

  :global(.tabs-trigger) {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    min-height: var(--size-pane-header);
    border: 0;
    border-right: 1px solid var(--color-border-subtle);
    border-radius: 0;
    background: transparent;
    color: var(--color-muted);
    padding: 0 0.75rem;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  :global(.tabs-trigger)::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: transparent;
  }

  :global(.tabs-trigger:hover:not([data-disabled])) {
    background: var(--color-panel);
    color: var(--color-text);
  }

  :global(.tabs-trigger[data-state="active"]) {
    background: var(--color-tab-active);
    color: var(--color-accent);
  }

  :global(.tabs-trigger[data-state="active"]::before) {
    background: var(--color-accent);
  }

  :global(.tabs-trigger:focus-visible) {
    outline: 1px solid var(--color-focus-ring);
    outline-offset: -1px;
  }

  :global(.tabs-trigger[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.5;
  }

  :global(.tabs-trigger b) {
    min-width: 1rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: 999px;
    color: var(--color-accent);
    padding: 0 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    line-height: 1.35;
  }
</style>
