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
    gap: 0.15rem;
    min-width: 0;
    overflow-x: auto;
    padding: 0.3rem;
  }

  :global(.tabs-trigger) {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.25rem;
    min-height: var(--control-height-xs);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-muted);
    padding: 0.18rem 0.42rem;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    cursor: pointer;
  }

  :global(.tabs-trigger:hover:not([data-disabled])),
  :global(.tabs-trigger[data-state="active"]) {
    border-color: var(--color-border-subtle);
    background: var(--color-panel-raised);
    color: var(--color-text);
  }

  :global(.tabs-trigger:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  :global(.tabs-trigger[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.5;
  }

  :global(.tabs-trigger b) {
    color: var(--color-accent);
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
  }
</style>
