<script lang="ts">
import AppWindow from "@lucide/svelte/icons/app-window";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import Popover, {
  PopoverCommandList,
  PopoverFooter,
  PopoverHeader,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { ItemSurface } from "$lib/presentation";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/application/commands/command-registry";
import { looksLikePath, tildePath } from "$lib/domain/filesystem/project-path";
import ConversationActivityIndicator from "$lib/presentation/conversations/ConversationActivityIndicator.svelte";
import {
  conversationRowStatusLabel,
  conversationStatusLabel,
} from "$lib/presentation/conversations/conversation-row-state";
import type { ProjectSwitcherItem } from "$lib/features/projects/state/project-switcher";
import ProjectIcon from "./ProjectIcon.svelte";

type Props = {
  items?: ProjectSwitcherItem[];
  popoverItems?: ProjectSwitcherItem[];
  activeKey?: string;
  homeDir?: string;
  buildMenuItems?: (item: ProjectSwitcherItem) => ContextMenuItem[];
  /** Popover state; bindable so shortcuts can open the switcher. */
  open?: boolean;
  onSelect?: (projectId: string) => void;
  /** Open Nerve's folder browser. */
  onOpenPicker?: () => void;
  /** Open a typed path directly. */
  onOpenPath?: (path: string) => void;
  /** Present only where the OS picker is truthful (desktop + local daemon). */
  onUseSystemPicker?: () => void;
};

let {
  items = [],
  popoverItems = [],
  activeKey,
  homeDir,
  buildMenuItems,
  open: popoverOpen = $bindable(false),
  onSelect,
  onOpenPicker,
  onOpenPath,
  onUseSystemPicker,
}: Props = $props();

let query = $state("");
const typedPath = $derived(query.trim());
const openPathItem = $derived(
  onOpenPath && looksLikePath(typedPath)
    ? {
        key: "open-path",
        openPath: typedPath,
        label: `Open ${typedPath}`,
        group: "Open",
        keywords: [typedPath],
      }
    : undefined,
);
const projectRows = $derived(
  popoverItems.map((item) => ({
    ...item,
    group: "",
    keywords: [
      item.project.name,
      item.project.dir,
      conversationStatusLabel(item.activity) ?? "",
    ],
  })),
);
const commandItems = $derived(
  openPathItem ? [openPathItem, ...projectRows] : projectRows,
);
const openFolderShortcut = getShortcutLabel("project.openFolder");

const switchAria = getShortcutAriaLabel("conversation.newFromProject");
/** Quiet projects (idle or all done) show no glyph. */
function showsActivity(item: ProjectSwitcherItem): boolean {
  return (
    item.activity.indicator !== "idle" &&
    item.activity.indicator !== "completed"
  );
}

function tabLabel(item: ProjectSwitcherItem): string {
  const status = showsActivity(item)
    ? conversationStatusLabel(item.activity)
    : undefined;
  return status ? `${item.label}: ${status}` : item.label;
}

function handleOpenChange(open: boolean) {
  popoverOpen = open;
  query = "";
}

function chooseProject(item: (typeof commandItems)[number]) {
  popoverOpen = false;
  if ("openPath" in item) onOpenPath?.(item.openPath);
  else onSelect?.(item.project.id);
}

function openFolder() {
  popoverOpen = false;
  onOpenPicker?.();
}

function useSystemPicker() {
  popoverOpen = false;
  onUseSystemPicker?.();
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
    triggerClass="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground [-webkit-app-region:no-drag] hover:bg-hover hover:text-foreground"
  >
    {#snippet trigger()}
      <span data-tour-id="guide-project-open">
        <LayoutGrid class="size-4" aria-hidden="true" />
      </span>
    {/snippet}

    <PopoverHeader title="Projects" meta={`${popoverItems.length}`} />

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
        {#if "openPath" in item}
          <span class="flex min-w-0 items-center gap-2 text-left">
            <FolderOpen
              class="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span class="min-w-0 truncate"
              >Open <span class="font-mono">{item.openPath}</span></span
            >
          </span>
        {:else}
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
            {@const status = conversationRowStatusLabel(item.activity)}
            <span class="grid min-w-0 flex-1 gap-0.5">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate">{item.project.name}</span>
                {#if showsActivity(item)}
                  <ConversationActivityIndicator
                    activity={item.activity}
                    variant="rail"
                  />
                {/if}
              </span>
              {#if status}
                <span
                  class={`min-w-0 truncate ${item.activity.tone === "warning" ? "text-warning" : "text-destructive"}`}
                >
                  {status}
                </span>
              {:else}
                <span class="min-w-0 truncate font-mono text-muted-foreground">
                  {tildePath(item.project.dir, homeDir)}
                </span>
              {/if}
            </span>
          </ItemSurface>
        {/if}
      {/snippet}
    </PopoverCommandList>

    <PopoverFooter>
      <Button
        variant="ghost"
        size="sm"
        data-tour-id="guide-project-browse"
        onclick={openFolder}
      >
        <FolderOpen aria-hidden="true" />
        Open folder
        {#if openFolderShortcut}
          <Kbd>{openFolderShortcut}</Kbd>
        {/if}
      </Button>
      {#if onUseSystemPicker}
        <Button variant="ghost" size="sm" onclick={useSystemPicker}>
          <AppWindow aria-hidden="true" />
          System picker
        </Button>
      {/if}
    </PopoverFooter>
  </Popover>

  <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
    {#each items as item (item.key)}
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
          class={`w-full min-w-0 gap-1.5 rounded-md bg-transparent px-2 hover:bg-transparent ${active ? "text-foreground data-[active]:bg-transparent" : "text-muted-foreground hover:text-foreground"}`}
          pressed={active}
          aria-current={active ? "page" : undefined}
          ariaLabel={tabLabel(item)}
          onclick={() => onSelect?.(item.project.id)}
        >
          {#if showsActivity(item)}
            <ConversationActivityIndicator
              activity={item.activity}
              variant="rail"
            />
          {/if}
          <span class="truncate">{item.label}</span>
        </Button>
      </ItemSurface>
    {/each}
  </div>
</nav>
