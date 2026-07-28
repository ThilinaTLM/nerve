<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import MoveLeft from "@lucide/svelte/icons/move-left";
import MoveRight from "@lucide/svelte/icons/move-right";
import Plus from "@lucide/svelte/icons/plus";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import type {
  WorkbenchTabIdentity,
  WorkbenchTabMenuBuilder,
  WorkbenchTabModel,
} from "./shell-types.js";

let {
  tabs = [],
  refreshShortcut,
  closeShortcut,
  closeOthersShortcut,
  newLabel = "New chat",
  newShortcut,
  newShortcutAria,
  buildMenuItems,
  onSelect,
  onClose,
  onRefresh,
  onCloseOther,
  onCloseRight,
  onCloseLeft,
  onNew,
  onReorder,
}: {
  tabs?: WorkbenchTabModel[];
  refreshShortcut?: string;
  closeShortcut?: string;
  closeOthersShortcut?: string;
  newLabel?: string;
  newShortcut?: string;
  newShortcutAria?: string;
  buildMenuItems?: WorkbenchTabMenuBuilder;
  onSelect?: (tab: WorkbenchTabIdentity) => void;
  onClose?: (tab: WorkbenchTabIdentity) => void;
  onRefresh?: (tab: WorkbenchTabIdentity) => void;
  onCloseOther?: (tab: WorkbenchTabIdentity) => void;
  onCloseRight?: (tab: WorkbenchTabIdentity) => void;
  onCloseLeft?: (tab: WorkbenchTabIdentity) => void;
  onNew?: () => void;
  onReorder?: (tab: WorkbenchTabIdentity, targetIndex: number) => void;
} = $props();

let scroller = $state<HTMLDivElement | null>(null);
let canScrollLeft = $state(false);
let canScrollRight = $state(false);
let draggedKey = $state<string | undefined>();
let dropIndex = $state<number | undefined>();
let announcement = $state("");

function updateOverflow() {
  if (!scroller) return;
  canScrollLeft = scroller.scrollLeft > 1;
  canScrollRight =
    scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
}

function scrollTabs(direction: -1 | 1) {
  scroller?.scrollBy({
    left: direction * Math.max(160, scroller.clientWidth * 0.75),
    behavior: "smooth",
  });
}

function startDrag(event: DragEvent, tab: WorkbenchTabModel) {
  if (!onReorder) return;
  draggedKey = tabKey(tab);
  event.dataTransfer?.setData("text/plain", draggedKey);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function dropTab(event: DragEvent, index: number) {
  event.preventDefault();
  const key = draggedKey ?? event.dataTransfer?.getData("text/plain");
  const tab = tabs.find((candidate) => tabKey(candidate) === key);
  if (tab) {
    onReorder?.(identity(tab), index);
    announcement = `${tab.label} moved to position ${index + 1}`;
  }
  draggedKey = undefined;
  dropIndex = undefined;
}

$effect(() => {
  if (!scroller) return;
  const observer = new ResizeObserver(updateOverflow);
  observer.observe(scroller);
  updateOverflow();
  return () => observer.disconnect();
});

$effect(() => {
  const active = tabs.find((tab) => tab.active);
  requestAnimationFrame(() => {
    updateOverflow();
    if (active && scroller) {
      const element = [
        ...scroller.querySelectorAll<HTMLElement>("[data-tab-key]"),
      ].find((candidate) => candidate.dataset.tabKey === tabKey(active));
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
});

function identity(tab: WorkbenchTabModel): WorkbenchTabIdentity {
  return { kind: tab.kind, id: tab.id };
}

function tabKey(tab: WorkbenchTabModel): string {
  return tab.key ?? `${tab.kind}:${tab.id}`;
}

function defaultMenu(tab: WorkbenchTabModel, index: number): ContextMenuItem[] {
  const id = identity(tab);
  const hasLeft = index > 0;
  const hasRight = index >= 0 && index < tabs.length - 1;
  const items: ContextMenuItem[] = [
    {
      label: "Refresh",
      icon: RefreshCw,
      shortcut: refreshShortcut,
      disabled: !onRefresh,
      onSelect: () => onRefresh?.(id),
    },
  ];
  if (onReorder) {
    items.push(
      { type: "separator" },
      {
        label: "Move Left",
        icon: MoveLeft,
        disabled: !hasLeft,
        onSelect: () => onReorder(id, index - 1),
      },
      {
        label: "Move Right",
        icon: MoveRight,
        disabled: !hasRight,
        onSelect: () => onReorder(id, index + 1),
      },
    );
  }
  items.push(
    { type: "separator" },
    {
      label: "Close Pane",
      icon: X,
      shortcut: closeShortcut,
      disabled: tab.closeable === false || !onClose,
      onSelect: () => onClose?.(id),
    },
    {
      label: "Close Other Panes",
      icon: X,
      shortcut: closeOthersShortcut,
      disabled: tabs.length <= 1 || !onCloseOther,
      onSelect: () => onCloseOther?.(id),
    },
    {
      label: "Close Panes on Right",
      icon: X,
      disabled: !hasRight || !onCloseRight,
      onSelect: () => onCloseRight?.(id),
    },
    {
      label: "Close Panes on Left",
      icon: X,
      disabled: !hasLeft || !onCloseLeft,
      onSelect: () => onCloseLeft?.(id),
    },
  );
  return items;
}

function menuItems(tab: WorkbenchTabModel, index: number): ContextMenuItem[] {
  return buildMenuItems?.({ tab, tabs, index }) ?? defaultMenu(tab, index);
}
</script>

<nav class="editor-tab-strip" aria-label="Open editor tabs">
  {#if canScrollLeft || canScrollRight}
    <Button
      variant="ghost"
      size="icon-sm"
      class="tab-overflow-control"
      ariaLabel="Scroll tabs left"
      disabled={!canScrollLeft}
      onclick={() => scrollTabs(-1)}
    >
      <ChevronLeft size={14} strokeWidth={2.2} />
    </Button>
  {/if}
  <div class="tab-scroller" bind:this={scroller} onscroll={updateOverflow}>
    {#each tabs as tab, index (tabKey(tab))}
      {@const Icon = tab.icon}
      {@const SelectIcon = tab.selectIcon}
      {@const ToggleIcon = tab.toggle?.icon}
      <ContextMenu
        items={menuItems(tab, index)}
        triggerClass={`editor-tab-menu-trigger ${tab.wide ? "wide-tab" : ""}`}
      >
        <div
          class="editor-tab"
          class:active={tab.active}
          class:running={tab.running}
          class:errored={Boolean(tab.error)}
          class:dragging={draggedKey === tabKey(tab)}
          class:drop-target={dropIndex === index && draggedKey !== tabKey(tab)}
          data-tab-key={tabKey(tab)}
          role="presentation"
          draggable={Boolean(onReorder)}
          ondragstart={(event) => startDrag(event, tab)}
          ondragover={(event) => {
            if (!onReorder) return;
            event.preventDefault();
            dropIndex = index;
          }}
          ondrop={(event) => dropTab(event, index)}
          ondragend={() => {
            draggedKey = undefined;
            dropIndex = undefined;
          }}
        >
          <div class="tab-leading">
            {#if tab.toggle && ToggleIcon}
              <button
                type="button"
                class="tab-file-toggle"
                aria-label={tab.toggle.label}
                title={tab.toggle.title ?? tab.toggle.label}
                disabled={tab.toggle.disabled}
                onclick={(event) => {
                  event.stopPropagation();
                  tab.toggle?.onClick?.(event);
                }}
              >
                <ToggleIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </button>
            {:else if tab.status?.tone}
              <StatusDot
                class="tab-agent-status"
                tone={tab.status.tone}
                pulse={tab.status.pulse}
                label={tab.status.label}
              />
            {:else if tab.status || tab.running || tab.error}
              <span
                class="tab-status"
                title={tab.status?.label}
                aria-hidden="true"
              ></span>
            {:else if Icon}
              <span class="tab-kind-icon">
                <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            {/if}
          </div>
          <button
            type="button"
            class="tab-select"
            role="tab"
            aria-selected={tab.active}
            title={tab.title ?? tab.label}
            onclick={() => onSelect?.(identity(tab))}
          >
            {#if SelectIcon}
              <span class="tab-kind-icon">
                <SelectIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            {/if}
            <span class="tab-title">{tab.label}</span>
            {#if tab.draft}
              <span class="draft-dot" title="Draft" aria-label="Draft"></span>
            {/if}
          </button>
          <button
            type="button"
            class="tab-close"
            aria-label={`Close ${tab.label}`}
            title="Close tab"
            disabled={tab.closeable === false}
            onclick={() => onClose?.(identity(tab))}
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      </ContextMenu>
    {/each}
  </div>
  {#if canScrollLeft || canScrollRight}
    <Button
      variant="ghost"
      size="icon-sm"
      class="tab-overflow-control"
      ariaLabel="Scroll tabs right"
      disabled={!canScrollRight}
      onclick={() => scrollTabs(1)}
    >
      <ChevronRight size={14} strokeWidth={2.2} />
    </Button>
  {/if}

  {#if onNew}
    <div class="tab-actions">
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={newLabel}
        aria-keyshortcuts={newShortcutAria}
        title={newShortcut ? `${newLabel} (${newShortcut})` : newLabel}
        onclick={onNew}
      >
        <Plus size={13} strokeWidth={2.25} />
      </Button>
    </div>
  {/if}
  <span class="sr-only" aria-live="polite">{announcement}</span>
</nav>
