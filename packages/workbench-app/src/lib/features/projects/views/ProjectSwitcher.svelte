<script lang="ts">
import FolderSearch from "@lucide/svelte/icons/folder-search";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import Popover, {
  PopoverBody,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  ItemCollection,
  ItemScrollRegion,
  ItemSurface,
} from "$lib/presentation";
import { getShortcutAriaLabel } from "$lib/application/commands/command-registry";
import { tildePath } from "$lib/domain/filesystem/project-path";
import {
  projectActivitySignal,
  type ProjectActivitySignal,
  type ProjectSwitcherItem,
} from "$lib/features/projects/state/project-switcher";
import ProjectActivityStatus from "./ProjectActivityStatus.svelte";
import ProjectIcon from "./ProjectIcon.svelte";

type Props = {
  items?: ProjectSwitcherItem[];
  popoverItems?: ProjectSwitcherItem[];
  activeKey?: string;
  homeDir?: string;
  buildMenuItems?: (item: ProjectSwitcherItem) => ContextMenuItem[];
  onSelect?: (projectId: string) => void;
  onOpenPicker?: () => void;
};

let {
  items = [],
  popoverItems = [],
  activeKey,
  homeDir,
  buildMenuItems,
  onSelect,
  onOpenPicker,
}: Props = $props();

let popoverOpen = $state(false);
let query = $state("");
let selectedIndex = $state(-1);
let scrollEl = $state<HTMLDivElement | undefined>(undefined);

const filteredPopoverItems = $derived.by(() => {
  const q = query.trim().toLowerCase();
  if (!q) return popoverItems;
  return popoverItems.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.project.name.toLowerCase().includes(q) ||
      item.project.dir.toLowerCase().includes(q),
  );
});
const activeDescendant = $derived(
  selectedIndex >= 0 && filteredPopoverItems[selectedIndex]
    ? `project-popover:${encodeURIComponent(filteredPopoverItems[selectedIndex].key)}`
    : undefined,
);

const switchAria = getShortcutAriaLabel("conversation.newFromProject");
function tabLabel(item: ProjectSwitcherItem): string {
  const signal = projectActivitySignal(item.activity, item.tasks);
  return signal ? `${item.label}: ${signal.summary}` : item.label;
}

function conversationSignalClass(tone: ProjectActivitySignal["tone"]): string {
  if (tone === "warn") return "bg-warning text-warning-foreground";
  if (tone === "danger")
    return "bg-destructive-solid text-destructive-solid-foreground";
  return "bg-info text-info-foreground";
}

function handleOpenChange(open: boolean) {
  popoverOpen = open;
  query = "";
  selectedIndex = -1;
}

function chooseProject(item: ProjectSwitcherItem) {
  popoverOpen = false;
  onSelect?.(item.project.id);
}

function browseProjects() {
  popoverOpen = false;
  onOpenPicker?.();
}

function scrollSelectionIntoView() {
  requestAnimationFrame(() => {
    scrollEl
      ?.querySelector('[role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  });
}

function handlePopoverKeydown(event: KeyboardEvent) {
  const count = filteredPopoverItems.length;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (count) {
      selectedIndex =
        selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, count - 1);
      scrollSelectionIntoView();
    }
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (count) {
      selectedIndex = Math.max(
        0,
        selectedIndex < 0 ? count - 1 : selectedIndex - 1,
      );
      scrollSelectionIntoView();
    }
  }
}

function handleSubmit(event: Event) {
  event.preventDefault();
  const target = filteredPopoverItems[selectedIndex >= 0 ? selectedIndex : 0];
  if (target) chooseProject(target);
}
</script>

<nav
  class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
  aria-label="Projects"
>
  <Popover
    open={popoverOpen}
    onOpenChange={handleOpenChange}
    size="xl"
    side="bottom"
    align="start"
    sideOffset={7}
    ariaLabel="Switch project"
    triggerTitle="Switch project"
    triggerAriaKeyShortcuts={switchAria}
    triggerClass="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
    class="max-w-[calc(100dvw-1rem)]"
  >
    {#snippet trigger()}
      <span data-tour-id="guide-project-open">
        <LayoutGrid class="size-4" aria-hidden="true" />
      </span>
    {/snippet}

    <PopoverBody class="gap-0 p-0">
      <div role="presentation" onkeydown={handlePopoverKeydown}>
        <form class="grid items-center p-2" onsubmit={handleSubmit}>
          <SearchInput
            bind:value={query}
            onValueChange={() => (selectedIndex = -1)}
            placeholder="Search projects"
            ariaLabel="Search projects"
          />
        </form>

        <ItemScrollRegion
          bind:viewport={scrollEl}
          {activeKey}
          viewportClass="max-h-[min(26rem,calc(100dvh-9rem))]"
          contentClass="grid gap-1 p-2 pt-0"
        >
          {#if filteredPopoverItems.length}
            <Tooltip.Provider delayDuration={300} disableHoverableContent>
              <div
                class="grid gap-1"
                role="listbox"
                aria-label="Recent projects"
                tabindex={-1}
                aria-activedescendant={activeDescendant}
              >
                {#each filteredPopoverItems as item, index (item.key)}
                  {@const selected = selectedIndex === index}
                  {@const active = item.key === activeKey}
                  <ItemSurface
                    id={`project-popover:${encodeURIComponent(item.key)}`}
                    role="option"
                    ariaLabel={`${item.project.name}${active ? ", current project" : ""}`}
                    ariaSelected={selected}
                    tabindex={-1}
                    itemKey={item.key}
                    menuItems={buildMenuItems?.(item) ?? []}
                    menuDisabled={!buildMenuItems}
                    hover="default"
                    class={`group w-full cursor-pointer items-center gap-2.5 border border-transparent px-2.5 py-2 text-left focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${selected ? "bg-accent/90 hover:bg-accent dark:bg-accent/80 dark:hover:bg-accent/80" : "hover:bg-accent/90 dark:hover:bg-accent/70"}`}
                    onclick={() => chooseProject(item)}
                    onkeydown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        chooseProject(item);
                      }
                    }}
                  >
                    <ProjectIcon projectId={item.project.id} class="size-8" />
                    <span class="grid min-w-0 flex-1 gap-0.5">
                      <span class="flex min-w-0 items-center gap-1.5">
                        <strong
                          class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                        >
                          {item.project.name}
                        </strong>
                        <span class="ml-auto min-w-0 flex-none">
                          <ProjectActivityStatus {item} />
                        </span>
                      </span>
                      <span
                        class="min-w-0 truncate font-mono text-xs text-muted-foreground"
                      >
                        {tildePath(item.project.dir, homeDir)}
                      </span>
                    </span>
                  </ItemSurface>
                {/each}
              </div>
            </Tooltip.Provider>
          {:else}
            <div
              class="grid min-h-28 place-items-center p-5 text-center text-sm text-muted-foreground"
            >
              {popoverItems.length
                ? "No projects match your search."
                : "No recent projects yet."}
            </div>
          {/if}
        </ItemScrollRegion>

        <div class="border-t border-border/60 p-2">
          <Button
            variant="ghost"
            size="sm"
            class="w-full justify-start"
            data-tour-id="guide-project-browse"
            onclick={browseProjects}
          >
            <FolderSearch class="size-4" aria-hidden="true" />
            Browse for a project
          </Button>
        </div>
      </div>
    </PopoverBody>
  </Popover>

  <ItemCollection
    {activeKey}
    class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
  >
    {#each items as item (item.key)}
      {@const signal = projectActivitySignal(item.activity, item.tasks)}
      {@const conversationActivityCount =
        item.activity.needsUser + item.activity.failed + item.activity.running}
      {@const combinedSignals =
        conversationActivityCount > 0 && item.tasks.running > 0}
      {@const active = item.key === activeKey}
      <ItemSurface
        itemKey={item.key}
        menuItems={buildMenuItems?.(item) ?? []}
        menuDisabled={!buildMenuItems}
        hover="soft"
        class="min-w-0 max-w-56 overflow-hidden [-webkit-app-region:no-drag]"
      >
        <Button
          variant="ghost"
          size="sm"
          class={`w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 hover:bg-transparent dark:hover:bg-transparent ${active ? "text-foreground data-[active]:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
          pressed={active}
          aria-current={active ? "page" : undefined}
          ariaLabel={tabLabel(item)}
          onclick={() => onSelect?.(item.project.id)}
        >
          {#if signal}
            <span
              class={combinedSignals
                ? "relative isolate h-4 w-7 flex-none"
                : "inline-flex size-4 flex-none items-center"}
              aria-hidden="true"
            >
              {#if conversationActivityCount}
                <span
                  class={`${combinedSignals ? "absolute top-0 left-0" : "relative"} z-10 inline-flex size-4 items-center justify-center rounded-full border-[1.5px] border-background text-xs leading-none tabular-nums ${conversationSignalClass(signal.tone)}`}
                >
                  <span class="scale-90">{conversationActivityCount}</span>
                </span>
              {/if}
              {#if item.tasks.running}
                <span
                  class={`${combinedSignals ? "absolute top-0 right-0" : "relative"} z-0 inline-flex size-4 items-center justify-center rounded-sm border-[1.5px] border-background bg-info text-xs leading-none text-info-foreground tabular-nums`}
                >
                  <span class="scale-90">{item.tasks.running}</span>
                </span>
              {/if}
            </span>
          {/if}
          <span class="truncate">{item.label}</span>
        </Button>
      </ItemSurface>
    {/each}
  </ItemCollection>
</nav>
