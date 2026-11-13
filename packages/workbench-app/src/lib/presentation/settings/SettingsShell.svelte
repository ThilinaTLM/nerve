<script lang="ts">
import type { Snippet } from "svelte";
import { tick } from "svelte";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/utils";
import SettingsBreadcrumb from "./SettingsBreadcrumb.svelte";
import { settingsSectionDomId } from "./section-id";
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
  /** Identity block above the nav: "User settings", or a project name. */
  scopeHeader?: SettingsScopeHeader;
  activePageId?: string;
  activeSectionId?: string;
  /** Open detail item of the active page; "" shows the page's list. */
  activeItemId?: string;
  ariaLabel?: string;
  class?: string;
  mainClass?: string;
  showHeader?: boolean;
  sidebarFooter?: Snippet;
  pageActions?: Snippet<[SettingsPageDef]>;
  /** Receives the page and the open item id ('' for the list). */
  children: Snippet<[SettingsPageDef, string]>;
  onPageChange?: (id: string) => void;
  /** An item id the page's detail does not list; the shell has returned to the list. */
  onUnknownItem?: (id: string, page: SettingsPageDef) => void;
  onSectionChange?: (id: string) => void;
};

let {
  pages,
  groups,
  scopeHeader,
  activePageId = $bindable(pages[0]?.id ?? ""),
  activeSectionId = $bindable(firstEnabledSectionId(pages[0])),
  activeItemId = $bindable(""),
  ariaLabel = "Settings pages",
  class: className,
  mainClass,
  showHeader = true,
  sidebarFooter,
  pageActions,
  children,
  onPageChange,
  onUnknownItem,
}: Props = $props();

let viewportElement = $state<HTMLElement | null>(null);

const activePage = $derived(
  pages.find((page) => page.id === activePageId) ?? pages[0],
);
const activeSections = $derived(activePage?.sections ?? []);
const detailItems = $derived(activePage?.detail?.items);
const openItem = $derived(
  activeItemId && activePage?.detail
    ? detailItems?.find((item) => item.id === activeItemId)
    : undefined,
);
// Without a known list the item is trusted; the detail view validates itself.
const inDetail = $derived(
  !!activeItemId && !!activePage?.detail && (!detailItems || !!openItem),
);

// An item the page does not know falls back to the list.
$effect(() => {
  if (!activeItemId || !activePage) return;
  if (inDetail) return;
  if (activePage.detail && !detailItems) return;
  const unknown = activeItemId;
  activeItemId = "";
  if (activePage.detail) onUnknownItem?.(unknown, activePage);
});

// Remember where the list was scrolled so back can restore it.
let listScrollTop = 0;
$effect(() => {
  const viewport = viewportElement;
  if (!viewport || inDetail) return;
  const onScroll = () => {
    listScrollTop = viewport.scrollTop;
  };
  viewport.addEventListener("scroll", onScroll, { passive: true });
  return () => viewport.removeEventListener("scroll", onScroll);
});

let wasInDetail = false;
$effect(() => {
  const now = inDetail;
  if (now === wasInDetail) return;
  wasInDetail = now;
  const viewport = viewportElement;
  if (!viewport) return;
  const top = now ? 0 : listScrollTop;
  const section = now ? activeSectionId : "";
  void tick().then(() => {
    const target = section
      ? viewport.querySelector<HTMLElement>(
          `#${CSS.escape(settingsSectionDomId(section))}`,
        )
      : null;
    if (target) target.scrollIntoView({ block: "start", behavior: "instant" });
    else viewport.scrollTo({ top, behavior: "instant" });
  });
});

function backToList(): void {
  activeItemId = "";
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || !inDetail) return;
  event.preventDefault();
  backToList();
}

$effect(() => {
  if (pages.length === 0 || pages.some((page) => page.id === activePageId))
    return;
  activePageId = pages[0].id;
  activeItemId = "";
  activeSectionId = firstEnabledSectionId(pages[0]);
});

$effect(() => {
  if (inDetail || activeSections.length === 0) return;
  if (activeSections.some((section) => section.id === activeSectionId)) return;
  activeSectionId = firstEnabledSectionId(activePage);
});

// Track the top-most visible section of the active page.
$effect(() => {
  const viewport = viewportElement;
  const sections = activeSections;
  if (inDetail || !viewport || sections.length < 2) return;
  return observeSettingsSections(viewport, sections, (id) => {
    if (id !== activeSectionId) activeSectionId = id;
  });
});

function selectPage(id: string): void {
  const page = pages.find((candidate) => candidate.id === id);
  if (!page) return;
  // The parent stays highlighted in detail; choosing it returns to the list.
  if (page.id === activePageId) {
    if (activeItemId) backToList();
    return;
  }
  activePageId = page.id;
  activeItemId = "";
  activeSectionId = firstEnabledSectionId(page);
  onPageChange?.(page.id);
  void tick().then(() => viewportElement?.scrollTo({ top: 0 }));
}
</script>

<!-- Escape bubbles up from focused controls to close an open detail; the section itself is not interactive. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section class={cn("settings-page-container", className)} onkeydown={onKeydown}>
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
          {#if inDetail}
            <SettingsBreadcrumb
              pageLabel={activePage.label}
              itemLabel={openItem?.label ?? activeItemId}
              onBack={backToList}
            />
          {:else if showHeader}
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
            {@render children(activePage, inDetail ? activeItemId : "")}
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
  border-right: 1px solid var(--border-subtle);
  background: var(--panel);
  --well: var(--well-on-panel);
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
