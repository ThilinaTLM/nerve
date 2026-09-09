<script lang="ts">
import FolderSearch from "@lucide/svelte/icons/folder-search";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import Popover, {
  createListNavigation,
  PopoverBody,
  PopoverFooter,
  PopoverHeader,
  PopoverSearch,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { ItemSurface } from "$lib/presentation";
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
let listEl = $state<HTMLDivElement | null>(null);

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
function rowId(item: ProjectSwitcherItem): string {
  return `project-popover:${encodeURIComponent(item.key)}`;
}

const navigation = createListNavigation({
  items: () => filteredPopoverItems,
  getId: rowId,
  viewport: () => listEl ?? undefined,
  onChoose: (item) => chooseProject(item),
});

const switchAria = getShortcutAriaLabel("conversation.newFromProject");
function tabLabel(item: ProjectSwitcherItem): string {
  const signal = projectActivitySignal(item.activity, item.tasks);
  return signal ? `${item.label}: ${signal.summary}` : item.label;
}

function conversationSignalClass(tone: ProjectActivitySignal["tone"]): string {
  if (tone === "warning") return "bg-warning text-warning-foreground";
  if (tone === "destructive")
    return "bg-destructive-solid text-destructive-solid-foreground";
  return "bg-info text-info-foreground";
}

function handleOpenChange(open: boolean) {
  popoverOpen = open;
  query = "";
  navigation.reset();
}

function chooseProject(item: ProjectSwitcherItem) {
  popoverOpen = false;
  onSelect?.(item.project.id);
}

function browseProjects() {
  popoverOpen = false;
  onOpenPicker?.();
}

function handleSubmit(event: Event) {
  event.preventDefault();
  navigation.chooseActive();
}
</script>

<nav
  class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
  aria-label="Projects"
>
  <Popover
    open={popoverOpen}
    onOpenChange={handleOpenChange}
    size="lg"
    side="bottom"
    align="start"
    ariaLabel="Switch project"
    triggerTitle="Switch project"
    triggerAriaKeyShortcuts={switchAria}
    triggerClass="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
  >
    {#snippet trigger()}
      <span data-tour-id="guide-project-open">
        <LayoutGrid class="size-4" aria-hidden="true" />
      </span>
    {/snippet}

    <PopoverHeader title="Projects" meta={`${filteredPopoverItems.length}`} />

    <PopoverSearch>
      <form onsubmit={handleSubmit}>
        <SearchInput
          bind:value={query}
          onValueChange={() => navigation.reset()}
          onkeydown={(event) => navigation.handleKeydown(event)}
          controls="project-switcher-list"
          activeDescendant={navigation.activeDescendant}
          placeholder="Search projects"
          ariaLabel="Search projects"
        />
      </form>
    </PopoverSearch>

    <PopoverBody
      bind:ref={listEl}
      id="project-switcher-list"
      role="listbox"
      ariaLabel="Recent projects"
    >
      {#if filteredPopoverItems.length}
        <Tooltip.Provider delayDuration={300} disableHoverableContent>
          {#each filteredPopoverItems as item, index (item.key)}
            {@const current = item.key === activeKey}
            <ItemSurface
              id={rowId(item)}
              role="option"
              ariaLabel={`${item.project.name}${current ? ", current project" : ""}`}
              ariaSelected={current}
              tabindex={-1}
              tone="row"
              selected={current}
              menuItems={buildMenuItems?.(item) ?? []}
              menuDisabled={!buildMenuItems}
              hover="default"
              class={`w-full cursor-pointer items-center gap-2 px-1.5 py-1 text-left focus-visible:outline-none ${navigation.isActive(index) ? "outline outline-1 -outline-offset-1 outline-ring/55" : ""}`}
              onclick={() => chooseProject(item)}
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  chooseProject(item);
                }
              }}
            >
              <!-- Sized to the two-line text block beside it, not to the
                   single-line icons used elsewhere in the panel. -->
              <ProjectIcon projectId={item.project.id} class="size-7" />
              <span class="grid min-w-0 flex-1 gap-0.5">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="min-w-0 flex-1 truncate">
                    {item.project.name}
                  </span>
                  <span class="ml-auto min-w-0 flex-none">
                    <ProjectActivityStatus {item} />
                  </span>
                </span>
                <span class="min-w-0 truncate font-mono text-muted-foreground">
                  {tildePath(item.project.dir, homeDir)}
                </span>
              </span>
            </ItemSurface>
          {/each}
        </Tooltip.Provider>
      {:else}
        <p class="px-1.5 py-6 text-center text-muted-foreground">
          {popoverItems.length
            ? "No projects match your search."
            : "No recent projects yet."}
        </p>
      {/if}
    </PopoverBody>

    <PopoverFooter>
      <Button
        variant="ghost"
        size="xs"
        class="justify-start"
        data-tour-id="guide-project-browse"
        onclick={browseProjects}
      >
        <FolderSearch class="size-4" aria-hidden="true" />
        Browse for a project
      </Button>
    </PopoverFooter>
  </Popover>

  <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
    {#each items as item (item.key)}
      {@const signal = projectActivitySignal(item.activity, item.tasks)}
      {@const conversationActivityCount =
        item.activity.needsUser + item.activity.failed + item.activity.running}
      {@const combinedSignals =
        conversationActivityCount > 0 && item.tasks.running > 0}
      {@const active = item.key === activeKey}
      <ItemSurface
        tone="row"
        selected={active}
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
  </div>
</nav>
