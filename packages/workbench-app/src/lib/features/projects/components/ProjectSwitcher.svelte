<script lang="ts">
import FolderSearch from "@lucide/svelte/icons/folder-search";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/core/shortcuts/registry";
import {
  projectActivityIndicator,
  type ProjectSwitcherItem,
} from "$lib/features/projects/state/project-switcher";

type Props = {
  items?: ProjectSwitcherItem[];
  activeKey?: string;
  buildMenuItems?: (item: ProjectSwitcherItem) => ContextMenuItem[];
  onSelect?: (projectId: string) => void;
  onOpenPicker?: () => void;
};

let {
  items = [],
  activeKey,
  buildMenuItems,
  onSelect,
  onOpenPicker,
}: Props = $props();

const switchShortcut = getShortcutLabel("conversation.newFromProject");
const switchTitle = switchShortcut
  ? `Switch project (${switchShortcut})`
  : "Switch project";
const switchAria = getShortcutAriaLabel("conversation.newFromProject");

function tabLabel(item: ProjectSwitcherItem): string {
  const indicator = projectActivityIndicator(item.activity);
  return indicator ? `${item.label}: ${indicator.summary}` : item.label;
}
</script>

<nav
  class="project-switcher flex min-w-0 items-center gap-1"
  aria-label="Projects"
>
  <Button
    variant="ghost"
    size="icon-sm"
    class="shrink-0"
    ariaLabel="Switch project"
    title={switchTitle}
    aria-keyshortcuts={switchAria}
    onclick={() => onOpenPicker?.()}
  >
    <FolderSearch class="size-4" aria-hidden="true" />
  </Button>
  {#if items.length}
    <span class="divider" aria-hidden="true"></span>
  {/if}
  <div class="flex min-w-0 items-center gap-0.5">
    {#each items as item (item.key)}
      {@const indicator = projectActivityIndicator(item.activity)}
      {@const active = item.key === activeKey}
      <ContextMenu
        items={buildMenuItems?.(item) ?? []}
        disabled={!buildMenuItems}
        triggerClass="block min-w-0 max-w-56"
      >
        <Button
          variant="ghost"
          size="sm"
          class={`w-full min-w-0 gap-1.5 px-2 ${active ? "" : "text-muted-foreground"}`}
          {active}
          pressed={active}
          aria-current={active ? "page" : undefined}
          ariaLabel={tabLabel(item)}
          title={`${item.project.dir}${indicator ? ` — ${indicator.summary}` : ""}`}
          onclick={() => onSelect?.(item.project.id)}
        >
          {#if indicator}
            <StatusDot
              tone={indicator.tone}
              size="xs"
              pulse={indicator.pulse}
            />
          {/if}
          <span class="truncate">{item.label}</span>
        </Button>
      </ContextMenu>
    {/each}
  </div>
</nav>

<style>
.project-switcher {
  -webkit-app-region: no-drag;
}
</style>
