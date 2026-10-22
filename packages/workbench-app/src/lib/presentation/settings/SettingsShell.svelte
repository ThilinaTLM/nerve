<script lang="ts">
import type { Snippet } from "svelte";
import { tick } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/utils";
import SettingsNav from "./SettingsNav.svelte";
import SettingsPageHeader from "./SettingsPageHeader.svelte";
import {
  firstEnabledSectionId,
  observeSettingsSections,
} from "./settings-navigation.svelte";
import type {
  SettingsNavGroup,
  SettingsPageDef,
  SettingsScopeHeader,
} from "./settings-component-contracts";

type Props = {
  /** Page headers and content; the nav lists them through `groups`. */
  pages: SettingsPageDef[];
  groups: SettingsNavGroup[];
  /** Identity block above the nav: "User settings", or a project name and path. */
  scopeHeader?: SettingsScopeHeader;
  activePageId?: string;
  activeSectionId?: string;
  ariaLabel?: string;
  class?: string;
  mainClass?: string;
  showHeader?: boolean;
  sidebarFooter?: Snippet;
  pageActions?: Snippet<[SettingsPageDef]>;
  children: Snippet<[SettingsPageDef]>;
  onPageChange?: (id: string) => void;
  onSectionChange?: (id: string) => void;
};

let {
  pages,
  groups,
  scopeHeader,
  activePageId = $bindable(pages[0]?.id ?? ""),
  activeSectionId = $bindable(firstEnabledSectionId(pages[0])),
  ariaLabel = "Settings pages",
  class: className,
  mainClass,
  showHeader = true,
  sidebarFooter,
  pageActions,
  children,
  onPageChange,
}: Props = $props();

let viewportElement = $state<HTMLElement | null>(null);

const activePage = $derived(
  pages.find((page) => page.id === activePageId) ?? pages[0],
);
const activeSections = $derived(activePage?.sections ?? []);

$effect(() => {
  if (pages.length === 0 || pages.some((page) => page.id === activePageId))
    return;
  activePageId = pages[0].id;
  activeSectionId = firstEnabledSectionId(pages[0]);
});

$effect(() => {
  if (activeSections.length === 0) return;
  if (activeSections.some((section) => section.id === activeSectionId)) return;
  activeSectionId = firstEnabledSectionId(activePage);
});

// Track the top-most visible section of the active page.
$effect(() => {
  const viewport = viewportElement;
  const sections = activeSections;
  if (!viewport || sections.length < 2) return;
  return observeSettingsSections(viewport, sections, (id) => {
    if (id !== activeSectionId) activeSectionId = id;
  });
});

function selectPage(id: string): void {
  const page = pages.find((candidate) => candidate.id === id);
  if (!page || page.id === activePageId) return;
  activePageId = page.id;
  activeSectionId = firstEnabledSectionId(page);
  onPageChange?.(page.id);
  void tick().then(() => viewportElement?.scrollTo({ top: 0 }));
}
</script>

<section class={cn("settings-page-container", className)}>
  <div class="settings-page">
    <aside
      class="settings-sidebar flex flex-col gap-3 overflow-hidden"
      aria-label={ariaLabel}
    >
      <SettingsNav
        {groups}
        header={scopeHeader}
        {ariaLabel}
        activeId={activePageId}
        onSelect={selectPage}
      />
      {#if sidebarFooter}
        <div class="flex-none">
          {@render sidebarFooter()}
        </div>
      {/if}
    </aside>

    <ScrollArea
      class="settings-scroll"
      bind:viewportRef={viewportElement}
      viewportClass="settings-viewport"
    >
      <div
        class={cn("settings-main", mainClass)}
        data-tour-id={activePage?.id === "skills"
          ? "settings-skills"
          : undefined}
      >
        {#if activePage}
          {#if showHeader}
            <SettingsPageHeader
              title={activePage.label}
              description={activePage.description}
            >
              {#snippet actions()}
                {#if pageActions}
                  {@render pageActions(activePage)}
                {/if}
              {/snippet}
            </SettingsPageHeader>
          {/if}

          <div class="grid min-w-0 gap-5">
            {@render children(activePage)}
          </div>
        {/if}
      </div>
    </ScrollArea>
  </div>
</section>

<style>
/*
 * Settings page chrome only. Everything inside a settings page body is built
 * from the workbench settings primitives with Tailwind token utilities; do not
 * add content styling here. The compact layout is container-relative: the
 * settings pane is resizable, so it follows its own width, not the viewport.
 */
.settings-page-container {
  height: 100%;
  min-width: 0;
  min-height: 0;
  container: settings-page / inline-size;
}

.settings-page {
  display: grid;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-columns: 14rem minmax(0, 1fr);
  background: var(--background);
  color: var(--foreground);
}

.settings-sidebar {
  min-height: 0;
  border-right: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  background: var(--panel);
  color: var(--foreground);
  padding: 0.9rem 0.7rem;
}

/* ScrollArea renders its own root and viewport (escape-hatch reason 5). */
.settings-page :global(.settings-scroll) {
  min-width: 0;
  min-height: 0;
}

.settings-page :global(.settings-viewport) {
  scroll-behavior: smooth;
  padding: 1.5rem 1.5rem 4rem;
}

.settings-main {
  display: grid;
  align-content: start;
  gap: 1.5rem;
  width: min(100%, 46rem);
  min-width: 0;
  /* Keep the capped content column centred in the wider settings pane. */
  margin-inline: auto;
}

@container settings-page (max-width: 46rem) {
  .settings-page {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .settings-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>
