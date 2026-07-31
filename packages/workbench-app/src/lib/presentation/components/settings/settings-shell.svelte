<script lang="ts">
import type { Snippet } from "svelte";
import { tick } from "svelte";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { ScrollArea } from "@nervekit/ui-kit/components/ui/scroll-area";
import { cn } from "@nervekit/ui-kit/core/utils";
import SettingsPageHeader from "./settings-page-header.svelte";
import { settingsSectionDomId } from "./section-id";
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

function firstEnabledSectionId(page?: SettingsPageDef): string {
  const sections = page?.sections ?? [];
  return (
    (sections.find((section) => !section.disabled) ?? sections[0])?.id ?? ""
  );
}

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

  let frame = 0;
  let observer: IntersectionObserver | undefined;

  let visible: string[] = [];
  const updateActive = () => {
    const next = sections.find((section) => visible.includes(section.id));
    if (next && next.id !== activeSectionId) activeSectionId = next.id;
  };

  frame = requestAnimationFrame(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-settings-section");
          if (!id) continue;
          if (entry.isIntersecting) {
            if (!visible.includes(id)) visible = [...visible, id];
          } else {
            visible = visible.filter((value) => value !== id);
          }
        }
        updateActive();
      },
      { root: viewport, rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );

    for (const section of sections) {
      const element = viewport.querySelector(
        `#${CSS.escape(settingsSectionDomId(section.id))}`,
      );
      if (!element) continue;
      element.setAttribute("data-settings-section", section.id);
      observer.observe(element);
    }
  });

  return () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
  };
});

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
  const heading = viewportElement?.querySelector<HTMLElement>(
    `#${CSS.escape(`${domId}-title`)}`,
  );
  heading?.focus({ preventScroll: true });
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
              {#each page.sections as section (section.id)}
                <li>
                  <a
                    href={`#${settingsSectionDomId(section.id)}`}
                    aria-current={activeSectionId === section.id
                      ? "location"
                      : undefined}
                    class:active={activeSectionId === section.id}
                    onclick={(event) => {
                      event.preventDefault();
                      void selectSection(section.id);
                    }}>{section.label}</a
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </div>
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
</section>
