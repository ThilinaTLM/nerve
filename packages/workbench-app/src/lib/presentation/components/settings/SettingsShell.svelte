<script lang="ts">
import type { Snippet } from "svelte";
import { tick } from "svelte";
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/core/utils";
import SettingsPageHeader from "./SettingsPageHeader.svelte";
import { settingsSectionDomId } from "./section-id";
import {
  firstEnabledSectionId,
  flashSettingsSection,
  observeNavigationOverflow,
  observeSettingsSections,
  scrollNavigation,
} from "./settings-navigation.svelte";
import type { SettingsPageDef } from "./types";

type Props = {
  pages: SettingsPageDef[];
  activePageId?: string;
  activeSectionId?: string;
  title?: string;
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
  activePageId = $bindable(pages[0]?.id ?? ""),
  activeSectionId = $bindable(firstEnabledSectionId(pages[0])),
  title = "Settings",
  ariaLabel = "Settings pages",
  class: className,
  mainClass,
  showHeader = true,
  sidebarFooter,
  pageActions,
  children,
  onPageChange,
  onSectionChange,
}: Props = $props();

let viewportElement = $state<HTMLElement | null>(null);
let collapsedPageIds = $state<string[]>([]);
let navElement = $state<HTMLElement | null>(null);
let canScrollNavBack = $state(false);
let canScrollNavForward = $state(false);

const activePage = $derived(
  pages.find((page) => page.id === activePageId) ?? pages[0],
);
const activeSections = $derived(activePage?.sections ?? []);
const hasSubmenu = $derived(activeSections.length > 1);

$effect(() => {
  if (pages.length === 0) return;
  if (pages.some((page) => page.id === activePageId)) return;
  const next = pages[0];
  activePageId = next.id;
  activeSectionId = firstEnabledSectionId(next);
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

// Carousel affordance for the compact horizontal nav: arrows appear only on
// the sides that have clipped items. On desktop the nav is vertical and never
// overflows horizontally, so both flags stay false.
$effect(() => {
  const nav = navElement;
  if (!nav) return;
  return observeNavigationOverflow(nav, ({ back, forward }) => {
    canScrollNavBack = back;
    canScrollNavForward = forward;
  });
});

function scrollNav(direction: -1 | 1): void {
  scrollNavigation(navElement, direction);
}

async function scrollPanelToTop(): Promise<void> {
  await tick();
  viewportElement?.scrollTo({ top: 0 });
}

function isCollapsed(pageId: string): boolean {
  return collapsedPageIds.includes(pageId);
}

function selectPage(page: SettingsPageDef): void {
  if (page.id === activePageId) {
    if (page.sections.length > 1) {
      collapsedPageIds = isCollapsed(page.id)
        ? collapsedPageIds.filter((id) => id !== page.id)
        : [...collapsedPageIds, page.id];
    }
    return;
  }
  activePageId = page.id;
  activeSectionId = firstEnabledSectionId(page);
  collapsedPageIds = collapsedPageIds.filter((id) => id !== page.id);
  onPageChange?.(page.id);
  void scrollPanelToTop();
}

async function selectSection(sectionId: string): Promise<void> {
  activeSectionId = sectionId;
  onSectionChange?.(sectionId);
  await tick();
  const domId = settingsSectionDomId(sectionId);
  const element = viewportElement?.querySelector(`#${CSS.escape(domId)}`);
  element?.scrollIntoView({ block: "start" });
  if (element) flashSettingsSection(element);
  const heading = viewportElement?.querySelector<HTMLElement>(
    `#${CSS.escape(`${domId}-title`)}`,
  );
  heading?.focus({ preventScroll: true });
}
</script>

{#snippet sectionLinks(page: SettingsPageDef)}
  {#each page.sections as section (section.id)}
    <li>
      <a
        href={`#${settingsSectionDomId(section.id)}`}
        aria-current={activeSectionId === section.id ? "location" : undefined}
        class:active={activeSectionId === section.id}
        onclick={(event) => {
          event.preventDefault();
          void selectSection(section.id);
        }}>{section.label}</a
      >
    </li>
  {/each}
{/snippet}

<section class={cn("settings-page-container", className)}>
  <div class="settings-page">
    <aside class="settings-sidebar" aria-label={ariaLabel}>
      <div class="settings-sidebar-title">
        <strong>{title}</strong>
      </div>

      <div class="settings-nav-carousel">
        {#if canScrollNavBack}
          <button
            type="button"
            class="settings-nav-arrow settings-nav-arrow-back"
            aria-label="Scroll pages back"
            onclick={() => scrollNav(-1)}
          >
            <ChevronLeft size={15} strokeWidth={2.2} />
          </button>
        {/if}

        <nav class="settings-nav" bind:this={navElement}>
          {#each pages as page (page.id)}
            {@const Icon = page.icon}
            {@const active = activePage?.id === page.id}
            {@const expandable = page.sections.length > 1}
            {@const expanded = active && expandable && !isCollapsed(page.id)}
            <div class="settings-nav-item">
              <button
                type="button"
                class:active
                aria-current={active ? "page" : undefined}
                aria-expanded={expandable ? expanded : undefined}
                aria-controls={expandable
                  ? `settings-submenu-${page.id}`
                  : undefined}
                onclick={() => selectPage(page)}
              >
                <Icon size={16} strokeWidth={2} />
                <span class="settings-nav-label">{page.label}</span>
                {#if expandable}
                  <ChevronRight
                    size={13}
                    strokeWidth={2.2}
                    class={cn(
                      "settings-nav-chevron",
                      expanded && "settings-nav-chevron-open",
                    )}
                  />
                {/if}
              </button>

              {#if expanded}
                <ul id={`settings-submenu-${page.id}`} class="settings-subnav">
                  {@render sectionLinks(page)}
                </ul>
              {/if}
            </div>
          {/each}
        </nav>

        {#if canScrollNavForward}
          <button
            type="button"
            class="settings-nav-arrow settings-nav-arrow-forward"
            aria-label="Scroll pages forward"
            onclick={() => scrollNav(1)}
          >
            <ChevronRight size={15} strokeWidth={2.2} />
          </button>
        {/if}
      </div>

      {#if activePage && activePage.sections.length > 1}
        <!-- Compact layout only: the nested submenu is hidden and the active
             page's sections render as a chip row under the nav instead. -->
        <ul
          class="settings-subnav settings-subnav-row"
          aria-label="Page sections"
        >
          {@render sectionLinks(activePage)}
        </ul>
      {/if}

      {#if sidebarFooter}
        {@render sidebarFooter()}
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

          <div class={cn("grid min-w-0", hasSubmenu ? "gap-5" : "gap-3")}>
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
 * add content styling here.
 *
 * The compact layout is container-relative: the settings pane is resizable, so
 * it must follow its own width rather than the viewport.
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
  grid-template-columns: 13.5rem minmax(0, 1fr);
  background: var(--background);
  color: var(--foreground);
}

.settings-sidebar {
  display: grid;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border-right: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  background: var(--sidebar);
  color: var(--sidebar-foreground);
  padding: 0.9rem 0.7rem;
}

.settings-sidebar-title {
  display: grid;
  gap: 0.12rem;
  padding: 0 0.35rem 0.7rem;
}

.settings-sidebar-title strong {
  color: var(--foreground);
  font-size: var(--text-sm);
  font-weight: 600;
}

.settings-nav-carousel {
  display: grid;
  min-height: 0;
}

/* Carousel arrows only exist in the compact horizontal layout. */
.settings-nav-arrow {
  display: none;
}

.settings-nav {
  display: grid;
  align-content: start;
  gap: 0.12rem;
  min-height: 0;
}

.settings-nav-item {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
}

.settings-nav button {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 0.5rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  padding: 0.32rem 0.5rem;
  text-align: left;
}

/* The page icons are rendered by Lucide components (escape-hatch reason 5). */
.settings-nav button :global(svg) {
  flex: none;
  opacity: 0.85;
}

.settings-nav button:hover {
  background: color-mix(in oklab, var(--sidebar-accent) 60%, transparent);
  color: var(--sidebar-foreground);
}

.settings-nav button.active {
  background: var(--sidebar-accent);
  color: var(--sidebar-accent-foreground);
}

.settings-nav-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The chevron is rendered by the Lucide icon component, so it has to be reached
 * into from the nav (escape-hatch reason 5). */
.settings-nav :global(.settings-nav-chevron) {
  flex: none;
  opacity: 0.7;
  transition: transform 120ms ease;
}

.settings-nav :global(.settings-nav-chevron-open) {
  transform: rotate(90deg);
}

/*
 * Sub-items are inset so their hover/active surface starts after the parent's
 * icon column, and their active fill stays lighter than the parent's so the
 * page selection keeps precedence over the current section.
 */
.settings-subnav {
  display: grid;
  gap: 0.05rem;
  /* Aligns the item box with the parent label, not just its text. */
  margin: 0.05rem 0 0.1rem 1.6rem;
  padding: 0;
  list-style: none;
}

.settings-subnav a {
  display: block;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  line-height: 1.2;
  padding: 0.28rem 0.5rem;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-subnav a:hover {
  background: color-mix(in oklab, var(--sidebar-accent) 35%, transparent);
  color: var(--sidebar-foreground);
}

.settings-subnav a.active {
  background: color-mix(in oklab, var(--sidebar-accent) 45%, transparent);
  color: var(--sidebar-accent-foreground);
  font-weight: 500;
}

/* Compact-layout submenu row; hidden while the nested submenu is in use. */
.settings-subnav-row {
  display: none;
}

/* ScrollArea renders its own root and viewport (escape-hatch reason 5). */
.settings-page :global(.settings-scroll) {
  min-width: 0;
  min-height: 0;
}

.settings-page :global(.settings-viewport) {
  scroll-behavior: smooth;
  padding: 1rem 1.1rem 4rem;
}

.settings-main {
  display: grid;
  align-content: start;
  gap: 0.85rem;
  width: min(100%, 44rem);
  min-width: 0;
}

@container settings-page (max-width: 46rem) {
  .settings-page {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  /* Two columns so the save status shares the title row on the right,
   * freeing the vertical space its own footer row used to take. */
  .settings-sidebar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: none;
    grid-auto-rows: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .settings-sidebar > :global(*) {
    grid-column: 1 / -1;
  }

  .settings-sidebar-title {
    grid-row: 1;
    grid-column: 1;
  }

  /* The status row is rendered by SettingsSidebarStatus through the
   * `sidebarFooter` snippet; only its placement belongs to the shell. */
  .settings-sidebar :global(.settings-sidebar-status) {
    grid-row: 1;
    grid-column: 2;
    align-self: start;
    border-top: 0;
    padding: 0;
  }

  .settings-nav-carousel {
    position: relative;
    min-width: 0;
  }

  /* Arrows float over the nav edges with a scrim fading into the sidebar
   * surface, and only render on sides that have clipped items. */
  .settings-nav-arrow {
    display: grid;
    place-items: center;
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 1;
    width: 1.75rem;
    border: 0;
    color: var(--muted-foreground);
    cursor: pointer;
    padding: 0;
  }

  .settings-nav-arrow:hover {
    color: var(--sidebar-foreground);
  }

  .settings-nav-arrow-back {
    left: 0;
    background: linear-gradient(to right, var(--sidebar) 55%, transparent);
    justify-items: start;
  }

  .settings-nav-arrow-forward {
    right: 0;
    background: linear-gradient(to left, var(--sidebar) 55%, transparent);
    justify-items: end;
  }

  /* Nav becomes a scrollbarless carousel: items snap into place and the
   * arrows above are the affordance that more pages exist. */
  .settings-nav {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 0.25rem;
    justify-content: start;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    /* Escape-hatch reason 2: the carousel has explicit arrow affordances. */
    scrollbar-width: none;
  }

  .settings-nav::-webkit-scrollbar {
    display: none;
  }

  .settings-nav-item {
    align-content: start;
    scroll-snap-align: start;
  }

  .settings-nav :global(.settings-nav-chevron) {
    display: none;
  }

  /* The nested submenu is replaced by the standalone chip row below. */
  .settings-nav .settings-subnav {
    display: none;
  }

  .settings-subnav-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    gap: 0.3rem;
    justify-content: start;
    margin: 0.45rem 0 0;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    /* Escape-hatch reason 2. */
    scrollbar-width: none;
  }

  .settings-subnav-row::-webkit-scrollbar {
    display: none;
  }

  .settings-subnav-row a {
    background: color-mix(in oklab, var(--sidebar-accent) 25%, transparent);
    padding: 0.3rem 0.65rem;
    scroll-snap-align: start;
  }
}
</style>
