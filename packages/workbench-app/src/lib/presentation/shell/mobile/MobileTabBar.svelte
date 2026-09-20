<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";
import type { PanelViewIcon } from "../shell-types.js";
import type { MobileTabId } from "./mobile-navigation.js";

export type MobileTabModel = {
  id: MobileTabId;
  label: string;
  icon: PanelViewIcon;
  /** Count shown as a pill; omitted or 0 renders nothing. */
  badge?: number;
  /** Quieter signal when there is a count worth noticing but not counting. */
  dot?: boolean;
};

let {
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: readonly MobileTabModel[];
  activeTab: MobileTabId;
  onSelect: (tab: MobileTabId) => void;
} = $props();
</script>

<nav class="mobile-tab-bar" aria-label="Primary">
  {#each tabs as tab (tab.id)}
    {@const active = tab.id === activeTab}
    {@const Icon = tab.icon}
    <button
      type="button"
      class={cn(
        "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md py-1.5 text-xs transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
      )}
      aria-current={active ? "page" : undefined}
      aria-label={tab.badge ? `${tab.label}, ${tab.badge} waiting` : tab.label}
      onclick={() => onSelect(tab.id)}
    >
      <span class="relative inline-flex">
        <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
        {#if tab.badge}
          <span
            class="absolute -right-2 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-warning px-1 text-xs font-medium text-warning-foreground"
            aria-hidden="true">{tab.badge > 99 ? "99+" : tab.badge}</span
          >
        {:else if tab.dot}
          <span
            class="absolute -right-1 -top-0.5 size-2 rounded-full bg-info"
            aria-hidden="true"
          ></span>
        {/if}
      </span>
      <span class="max-w-full truncate">{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
/* The bar owns the thumb zone: fixed row height plus the home-indicator inset,
 * so content above never has to reason about the safe area. */
.mobile-tab-bar {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  padding-bottom: calc(0.25rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--panel);
}
</style>
