<script lang="ts">
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import { getShortcutAriaLabel } from "$lib/core/shortcuts/registry";
import {
  projectActivitySignal,
  type ProjectActivitySignal,
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

const switchAria = getShortcutAriaLabel("conversation.newFromProject");
function tabLabel(item: ProjectSwitcherItem): string {
  const signal = projectActivitySignal(item.activity, item.tasks);
  return signal ? `${item.label}: ${signal.summary}` : item.label;
}

function conversationSignalClass(tone: ProjectActivitySignal["tone"]): string {
  if (tone === "warn") return "border-warning/60 text-warning";
  if (tone === "danger") return "border-destructive/60 text-destructive";
  return "border-info/60 text-info";
}
</script>

<nav
  class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
  aria-label="Projects"
>
  <Button
    variant="ghost"
    size="icon-sm"
    class="shrink-0 [-webkit-app-region:no-drag]"
    ariaLabel="Switch project"
    data-tour-id="guide-project-open"
    aria-keyshortcuts={switchAria}
    onclick={() => onOpenPicker?.()}
  >
    <LayoutGrid class="size-4" aria-hidden="true" />
  </Button>
  <div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
    {#each items as item (item.key)}
      {@const signal = projectActivitySignal(item.activity, item.tasks)}
      {@const conversationActivityCount =
        item.activity.needsUser + item.activity.failed + item.activity.running}
      {@const combinedSignals =
        conversationActivityCount > 0 && item.tasks.running > 0}
      {@const active = item.key === activeKey}
      <ContextMenu
        items={buildMenuItems?.(item) ?? []}
        disabled={!buildMenuItems}
        triggerClass="block min-w-0 max-w-56 overflow-hidden [-webkit-app-region:no-drag]"
      >
        <Button
          variant="ghost"
          size="sm"
          class={`w-full min-w-0 gap-1.5 rounded-xl px-2 ${active ? "border-border bg-muted/80 text-foreground hover:bg-muted" : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground"}`}
          pressed={active}
          aria-current={active ? "page" : undefined}
          ariaLabel={tabLabel(item)}
          onclick={() => onSelect?.(item.project.id)}
        >
          {#if signal}
            <span
              class={combinedSignals
                ? "relative isolate h-5 w-6 flex-none"
                : "inline-flex size-4 flex-none items-center"}
              aria-hidden="true"
            >
              {#if conversationActivityCount}
                <span
                  class={`${combinedSignals ? "absolute top-0 left-0" : "relative"} z-10 inline-flex size-4 items-center justify-center rounded-full border-[1.5px] text-xs leading-none tabular-nums ${active ? "bg-muted" : "bg-popover"} ${conversationSignalClass(signal.tone)}`}
                >
                  <span class="scale-90">{conversationActivityCount}</span>
                </span>
              {/if}
              {#if item.tasks.running}
                <span
                  class={`${combinedSignals ? "absolute right-0 bottom-0" : "relative"} z-0 inline-flex size-4 items-center justify-center rounded-full border-[1.5px] border-info/60 text-xs leading-none text-info tabular-nums`}
                >
                  <span class="scale-90">{item.tasks.running}</span>
                </span>
              {/if}
            </span>
          {/if}
          <span class="truncate">{item.label}</span>
        </Button>
      </ContextMenu>
    {/each}
  </div>
</nav>
