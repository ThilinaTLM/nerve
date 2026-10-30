<script lang="ts">
import FolderSearch from "@lucide/svelte/icons/folder-search";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import Popover, {
  PopoverCommandList,
  PopoverFooter,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
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
const commandItems = $derived(
  popoverItems.map((item) => ({
    ...item,
    group:
      item.activity.needsUser || item.activity.failed
        ? "Needs you"
        : item.activity.running ||
            item.activity.awaitingAsync ||
            item.launches.running
          ? "Running"
          : "Recent",
    keywords: [item.project.name, item.project.dir],
  })),
);

const switchAria = getShortcutAriaLabel("conversation.newFromProject");
function tabLabel(item: ProjectSwitcherItem): string {
  const signal = projectActivitySignal(item.activity, item.launches);
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
}

function chooseProject(item: ProjectSwitcherItem) {
  popoverOpen = false;
  onSelect?.(item.project.id);
}

function browseProjects() {
  popoverOpen = false;
  onOpenPicker?.();
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
    triggerClass="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
  >
    {#snippet trigger()}
      <span data-tour-id="guide-project-open">
        <LayoutGrid class="size-4" aria-hidden="true" />
      </span>
    {/snippet}

    <PopoverHeader title="Projects" meta={`${popoverItems.length}`} />

    <Tooltip.Provider delayDuration={300} disableHoverableContent>
      <PopoverCommandList
        items={commandItems}
        bind:query
        placeholder="Search projects"
        ariaLabel="Recent projects"
        isSelected={(item) => item.key === activeKey}
        onChoose={chooseProject}
        empty={popoverItems.length
          ? "No projects match your search."
          : "No recent projects yet."}
      >
        {#snippet row(item, { selected: current })}
          <ItemSurface
            ariaLabel={`${item.project.name}${current ? ", current project" : ""}`}
            tone="row"
            menuItems={buildMenuItems?.(item) ?? []}
            menuDisabled={!buildMenuItems}
            class="w-full items-center gap-2 text-left"
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
        {/snippet}
      </PopoverCommandList>
    </Tooltip.Provider>

    <PopoverFooter>
      <Button
        variant="ghost"
        size="sm"
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
      {@const signal = projectActivitySignal(item.activity, item.launches)}
      {@const conversationActivityCount =
        item.activity.needsUser +
        item.activity.failed +
        item.activity.running +
        item.activity.awaitingAsync}
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
          class={`w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 hover:bg-transparent dark:hover:bg-transparent ${active ? "text-foreground data-[active]:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
          pressed={active}
          aria-current={active ? "page" : undefined}
          ariaLabel={tabLabel(item)}
          onclick={() => onSelect?.(item.project.id)}
        >
          {#if signal && conversationActivityCount}
            <span
              class={`inline-flex size-4 flex-none items-center justify-center rounded-full text-xs leading-none tabular-nums ${conversationSignalClass(signal.tone)}`}
              aria-hidden="true"
            >
              <span class="scale-90">{conversationActivityCount}</span>
            </span>
          {:else if item.activity.resultReady}
            <span
              class="size-2 flex-none rounded-full bg-success"
              aria-hidden="true"
            ></span>
          {/if}
          <span class="truncate">{item.label}</span>
        </Button>
      </ItemSurface>
    {/each}
  </div>
</nav>
