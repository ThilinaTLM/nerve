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

<nav
  class="flex min-h-8 min-w-0 border-b border-border bg-card"
  aria-label="Open editor tabs"
>
  {#if canScrollLeft || canScrollRight}
    <Button
      variant="ghost"
      size="icon-sm"
      class="rounded-none border-r-border/62"
      ariaLabel="Scroll tabs left"
      disabled={!canScrollLeft}
      onclick={() => scrollTabs(-1)}
    >
      <ChevronLeft size={14} strokeWidth={2.2} />
    </Button>
  {/if}
  <div
    class="tab-scroller flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
    bind:this={scroller}
    onscroll={updateOverflow}
  >
    {#each tabs as tab, index (tabKey(tab))}
      {@const Icon = tab.icon}
      {@const SelectIcon = tab.selectIcon}
      {@const ToggleIcon = tab.toggle?.icon}
      <ContextMenu
        items={menuItems(tab, index)}
        triggerClass={`h-8 min-w-0 flex-none ${tab.wide ? "w-54 basis-54" : "w-50 basis-50"}`}
      >
        <div
          class="editor-tab group relative inline-grid h-8 w-full grid-cols-[auto_minmax(0,1fr)_auto] border-r border-r-border/62 bg-card text-muted-foreground data-[active]:bg-background data-[active]:text-foreground data-[dragging]:opacity-55 not-data-[active]:hover:bg-accent/60 not-data-[active]:hover:text-foreground"
          data-active={tab.active ? "" : undefined}
          data-running={tab.running ? "" : undefined}
          data-errored={tab.error ? "" : undefined}
          data-dragging={draggedKey === tabKey(tab) ? "" : undefined}
          data-drop-target={dropIndex === index && draggedKey !== tabKey(tab)
            ? ""
            : undefined}
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
          <div class="inline-grid h-8 w-5.5 place-items-center pl-1.5">
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
              <span class="tab-kind-icon flex-none">
                <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            {/if}
          </div>
          <button
            type="button"
            class="inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-left text-xs text-inherit focus-visible:z-1 focus-visible:-outline-offset-1 focus-visible:outline-1 focus-visible:outline-ring"
            role="tab"
            aria-selected={tab.active}
            title={tab.title ?? tab.label}
            onclick={() => onSelect?.(identity(tab))}
          >
            {#if SelectIcon}
              <span class="tab-kind-icon flex-none">
                <SelectIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            {/if}
            <span
              class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              >{tab.label}</span
            >
            {#if tab.draft}
              <span class="draft-dot" title="Draft" aria-label="Draft"></span>
            {/if}
          </button>
          <button
            type="button"
            class="inline-grid w-5.5 cursor-pointer place-items-center rounded-none border-0 bg-transparent text-inherit opacity-62 hover:bg-destructive/12 hover:text-destructive hover:opacity-100 focus-visible:z-1 focus-visible:-outline-offset-1 focus-visible:outline-1 focus-visible:outline-ring"
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
      class="rounded-none border-l-border/62"
      ariaLabel="Scroll tabs right"
      disabled={!canScrollRight}
      onclick={() => scrollTabs(1)}
    >
      <ChevronRight size={14} strokeWidth={2.2} />
    </Button>
  {/if}

  {#if onNew}
    <div class="flex items-center border-l border-l-border/62 px-1">
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={newLabel}
        aria-keyshortcuts={newShortcutAria}
        data-tour-id="tab-new-conversation"
        title={newShortcut ? `${newLabel} (${newShortcut})` : newLabel}
        onclick={onNew}
      >
        <Plus size={13} strokeWidth={2.25} />
      </Button>
    </div>
  {/if}
  <span class="sr-only" aria-live="polite">{announcement}</span>
</nav>

<style>
/* Hidden overflow scrollbar for the tab rail (escape-hatch reason 2). */
.tab-scroller {
  scrollbar-width: none;
}

.tab-scroller::-webkit-scrollbar {
  display: none;
}

/* Active-tab top bar and drag drop marker (escape-hatch reason 4). */
.editor-tab::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: transparent;
}

.editor-tab[data-active]::before {
  background: var(--primary);
}

.editor-tab[data-drop-target]::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 2px;
  background: var(--primary);
}

/* Status dots keep sub-scale geometry so the running/draft indicators stay
 * visually distinct. */
.tab-status {
  flex: none;
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: color-mix(in oklab, var(--muted-foreground) 50%, transparent);
}

/* Running pulse binds the shared tab-pulse keyframe (escape-hatch reason 1). */
.editor-tab[data-running] .tab-status {
  background: var(--info);
  box-shadow: 0 0 0 0 color-mix(in oklab, var(--info) 45%, transparent);
  animation: tab-pulse 1.3s ease-out infinite;
}

.editor-tab[data-errored] .tab-status {
  background: var(--destructive-solid);
}

.draft-dot {
  flex: none;
  width: 0.32rem;
  height: 0.32rem;
  border-radius: 999px;
  background: var(--primary);
}

/* Leading icons and the file toggle track the tab's own hover/active state, so
 * they stay as descendant rules rather than per-element utilities. */
.tab-file-toggle {
  display: inline-grid;
  width: 1.15rem;
  height: 1.15rem;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: color-mix(in oklab, var(--muted-foreground) 82%, transparent);
  cursor: pointer;
}

.tab-file-toggle:focus-visible {
  z-index: 1;
  outline: 1px solid var(--ring);
  outline-offset: -1px;
}

.tab-kind-icon {
  color: color-mix(in oklab, var(--muted-foreground) 82%, transparent);
}

.editor-tab[data-active] .tab-file-toggle,
.editor-tab:hover .tab-file-toggle,
.editor-tab[data-active] .tab-kind-icon,
.editor-tab:hover .tab-kind-icon {
  color: currentColor;
}

.tab-file-toggle:hover:not(:disabled) {
  background: var(--accent);
  color: var(--accent-foreground);
}

.tab-file-toggle:disabled {
  cursor: default;
  opacity: 0.7;
}
</style>
