<script lang="ts">
import type { Snippet } from "svelte";
import { tick } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import TabsBar, { type TabItem } from "@nervekit/ui-kit/components/ui/tabs-bar";
import * as Tabs from "@nervekit/ui-kit/components/ui/tabs";
import { cn } from "@nervekit/ui-kit/core/utils";
import SettingsPageHeader from "./settings-page-header.svelte";
import type { SettingsPageDef } from "./types";

type Props = {
  pages: SettingsPageDef[];
  activePageId?: string;
  activeTabId?: string;
  title?: string;
  ariaLabel?: string;
  class?: string;
  mainClass?: string;
  showHeader?: boolean;
  sidebarFooter?: Snippet;
  pageActions?: Snippet<[SettingsPageDef, string]>;
  children: Snippet<[SettingsPageDef, string]>;
  onPageChange?: (id: string) => void;
  onTabChange?: (id: string) => void;
};

function firstEnabledTabId(page?: SettingsPageDef): string {
  const tabs = page?.tabs ?? [];
  return (tabs.find((tab) => !tab.disabled) ?? tabs[0])?.id ?? "";
}

let {
  pages,
  activePageId = $bindable(pages[0]?.id ?? ""),
  activeTabId = $bindable(firstEnabledTabId(pages[0])),
  title = "Settings",
  ariaLabel = "Settings pages",
  class: className,
  mainClass,
  showHeader = true,
  sidebarFooter,
  pageActions,
  children,
  onPageChange,
  onTabChange,
}: Props = $props();

let viewportElement = $state<HTMLElement | null>(null);

const activePage = $derived(
  pages.find((page) => page.id === activePageId) ?? pages[0],
);
const tabItems = $derived<TabItem[]>(
  (activePage?.tabs ?? []).map((tab) => ({
    value: tab.id,
    label: tab.label,
    disabled: tab.disabled,
  })),
);

$effect(() => {
  if (pages.length === 0) return;
  if (pages.some((page) => page.id === activePageId)) return;
  const next = pages[0];
  activePageId = next.id;
  activeTabId = firstEnabledTabId(next);
});

$effect(() => {
  const tabs = activePage?.tabs ?? [];
  if (tabs.length === 0) return;
  if (tabs.some((tab) => tab.id === activeTabId)) return;
  activeTabId = firstEnabledTabId(activePage);
});

async function scrollPanelToTop(): Promise<void> {
  await tick();
  viewportElement?.scrollTo({ top: 0 });
}

function selectPage(id: string): void {
  if (id === activePageId) return;
  const next = pages.find((page) => page.id === id) ?? pages[0];
  activePageId = next.id;
  activeTabId = firstEnabledTabId(next);
  onPageChange?.(next.id);
  void scrollPanelToTop();
}

function selectTab(id: string): void {
  activeTabId = id;
  onTabChange?.(id);
  void scrollPanelToTop();
}
</script>

<section class={cn("settings-page", className)}>
  <aside class="settings-sidebar" aria-label={ariaLabel}>
    <div class="settings-sidebar-title">
      <strong>{title}</strong>
    </div>

    <nav class="settings-nav">
      {#each pages as page (page.id)}
        {@const Icon = page.icon}
        {@const active = activePage?.id === page.id}
        <button
          type="button"
          class:active
          aria-current={active ? "page" : undefined}
          onclick={() => selectPage(page.id)}
        >
          <Icon size={16} strokeWidth={2} />
          <span class="settings-nav-label">{page.label}</span>
        </button>
      {/each}
    </nav>

    {#if sidebarFooter}
      {@render sidebarFooter()}
    {/if}
  </aside>

  <ScrollArea
    class="settings-scroll"
    bind:viewportRef={viewportElement}
    viewportClass="settings-viewport"
  >
    <div class={cn("settings-main", mainClass)}>
      {#if activePage}
        {#if showHeader}
          <SettingsPageHeader
            title={activePage.label}
            description={activePage.description}
          >
            {#snippet actions()}
              {#if pageActions}
                {@render pageActions(activePage, activeTabId)}
              {/if}
            {/snippet}
          </SettingsPageHeader>
        {/if}

        {#if activePage.tabs.length > 1}
          <TabsBar
            tabs={tabItems}
            value={activeTabId}
            ariaLabel={`${activePage.label} tabs`}
            onValueChange={selectTab}
          >
            {#each activePage.tabs as tab (tab.id)}
              <Tabs.Content value={tab.id} class="grid gap-3">
                {#if tab.id === activeTabId}
                  {@render children(activePage, tab.id)}
                {/if}
              </Tabs.Content>
            {/each}
          </TabsBar>
        {:else}
          <div class="grid gap-3">
            {@render children(activePage, activeTabId)}
          </div>
        {/if}
      {/if}
    </div>
  </ScrollArea>
</section>
