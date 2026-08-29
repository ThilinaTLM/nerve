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
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import type {
  WorkbenchTabIdentity,
  WorkbenchTabMenuBuilder,
  WorkbenchTabModel,
} from "./shell-types.js";
import {
  adjacentTabIndexAtOverlap,
  moveTabKey,
} from "./horizontal-tab-reorder.js";

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
type PointerDrag = {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  previousX: number;
  offsetX: number;
  top: number;
  width: number;
  active: boolean;
  element: HTMLElement;
};

let pointerDrag = $state<PointerDrag | undefined>();
let previewKeys = $state<string[]>([]);
let previewLeft = $state(0);
let suppressSelect = $state(false);
let announcement = $state("");

const visualTabs = $derived.by(() => {
  if (!pointerDrag?.active) return tabs;
  const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]));
  return previewKeys.flatMap((key) => {
    const tab = byKey.get(key);
    return tab ? [tab] : [];
  });
});

const draggedTab = $derived(
  pointerDrag?.active
    ? tabs.find((tab) => tabKey(tab) === pointerDrag?.key)
    : undefined,
);

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

function beginPointerDrag(
  event: PointerEvent,
  tab: WorkbenchTabModel,
  element: HTMLElement,
) {
  if (!onReorder || event.button !== 0) return;
  if ((event.target as HTMLElement).closest("[data-no-tab-drag]")) return;
  const rect = element.getBoundingClientRect();
  pointerDrag = {
    key: tabKey(tab),
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    previousX: event.clientX,
    offsetX: event.clientX - rect.left,
    top: rect.top,
    width: rect.width,
    active: false,
    element,
  };
}

function updatePreviewPosition(clientX: number) {
  if (!pointerDrag || !scroller) return;
  const rail = scroller.getBoundingClientRect();
  const edge = 28;
  if (clientX < rail.left + edge) scroller.scrollBy({ left: -12 });
  else if (clientX > rail.right - edge) scroller.scrollBy({ left: 12 });
  previewLeft = Math.max(
    rail.left,
    Math.min(clientX - pointerDrag.offsetX, rail.right - pointerDrag.width),
  );
}

function handlePointerMove(event: PointerEvent) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  if (!pointerDrag.active) {
    if (
      Math.hypot(
        event.clientX - pointerDrag.startX,
        event.clientY - pointerDrag.startY,
      ) < 5
    )
      return;
    pointerDrag.active = true;
    previewKeys = tabs.map(tabKey);
    pointerDrag.element.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  const direction = Math.sign(event.clientX - pointerDrag.previousX) as
    | -1
    | 0
    | 1;
  pointerDrag.previousX = event.clientX;
  updatePreviewPosition(event.clientX);
  if (!scroller) return;
  const bounds = [...scroller.querySelectorAll<HTMLElement>("[data-tab-key]")]
    .filter((element) => element.dataset.tabKey !== pointerDrag?.key)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        key: element.dataset.tabKey ?? "",
        left: rect.left,
        width: rect.width,
      };
    });
  previewKeys = moveTabKey(
    previewKeys,
    pointerDrag.key,
    adjacentTabIndexAtOverlap({
      draggedKey: pointerDrag.key,
      orderedKeys: previewKeys,
      draggedLeft: previewLeft,
      draggedWidth: pointerDrag.width,
      direction,
      remainingTabs: bounds,
    }),
  );
}

function finishPointerDrag(event: PointerEvent, commit: boolean) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const drag = pointerDrag;
  if (drag.active) {
    if (drag.element.hasPointerCapture(event.pointerId))
      drag.element.releasePointerCapture(event.pointerId);
    if (commit) {
      const tab = tabs.find((candidate) => tabKey(candidate) === drag.key);
      const index = previewKeys.indexOf(drag.key);
      if (tab && index >= 0) {
        onReorder?.(identity(tab), index);
        announcement = `${tab.label} moved to position ${index + 1}`;
      }
    }
    suppressSelect = true;
    setTimeout(() => (suppressSelect = false), 0);
  }
  pointerDrag = undefined;
  previewKeys = [];
}

function cancelPointerDrag() {
  if (!pointerDrag) return;
  const drag = pointerDrag;
  if (drag.active && drag.element.hasPointerCapture(drag.pointerId))
    drag.element.releasePointerCapture(drag.pointerId);
  if (drag.active) {
    suppressSelect = true;
    setTimeout(() => (suppressSelect = false), 0);
  }
  pointerDrag = undefined;
  previewKeys = [];
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
        label: "Move left",
        icon: MoveLeft,
        disabled: !hasLeft,
        onSelect: () => onReorder(id, index - 1),
      },
      {
        label: "Move right",
        icon: MoveRight,
        disabled: !hasRight,
        onSelect: () => onReorder(id, index + 1),
      },
    );
  }
  items.push(
    { type: "separator" },
    {
      label: "Close pane",
      icon: X,
      shortcut: closeShortcut,
      disabled: tab.closeable === false || !onClose,
      onSelect: () => onClose?.(id),
    },
    {
      label: "Close others",
      icon: X,
      shortcut: closeOthersShortcut,
      disabled: tabs.length <= 1 || !onCloseOther,
      onSelect: () => onCloseOther?.(id),
    },
    {
      label: "Close to the right",
      icon: X,
      disabled: !hasRight || !onCloseRight,
      onSelect: () => onCloseRight?.(id),
    },
    {
      label: "Close to the left",
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

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={(event) => finishPointerDrag(event, true)}
  onpointercancel={(event) => finishPointerDrag(event, false)}
  onkeydown={(event) => {
    if (event.key === "Escape" && pointerDrag) cancelPointerDrag();
  }}
/>

<nav
  class="relative flex min-h-8 min-w-0 bg-card after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-1 after:h-px after:bg-primary/60 after:content-['']"
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
    {#each visualTabs as tab, index (tabKey(tab))}
      {@const Icon = tab.icon}
      {@const SelectIcon = tab.selectIcon}
      {@const ToggleIcon = tab.toggle?.icon}
      <ContextMenu
        items={menuItems(tab, index)}
        triggerClass={`h-8 min-w-0 flex-none ${index > 0 ? "-ml-px" : ""} ${tab.active ? "relative z-2" : ""} ${tab.wide ? "w-54 basis-54" : "w-50 basis-50"}`}
      >
        <div
          class="editor-tab group relative inline-grid h-8 w-full touch-pan-y grid-cols-[auto_minmax(0,1fr)_auto] rounded-t-md border border-b-0 border-border/62 bg-card text-muted-foreground data-[active]:border-primary/60 data-[active]:bg-background data-[active]:text-foreground data-[placeholder]:border data-[placeholder]:border-primary/55 data-[placeholder]:bg-primary/10 data-[placeholder]:text-transparent data-[placeholder]:shadow-inner data-[placeholder]:[&>*]:invisible not-data-[active]:not-data-[placeholder]:hover:bg-accent/60 not-data-[active]:not-data-[placeholder]:hover:text-foreground"
          data-active={tab.active ? "" : undefined}
          data-running={tab.running ? "" : undefined}
          data-errored={tab.error ? "" : undefined}
          data-placeholder={pointerDrag?.active &&
          pointerDrag.key === tabKey(tab)
            ? ""
            : undefined}
          data-tab-key={tabKey(tab)}
          role="presentation"
          onpointerdown={(event) =>
            beginPointerDrag(event, tab, event.currentTarget)}
        >
          <div class="inline-grid h-8 w-5.5 place-items-center pl-1.5">
            {#if tab.toggle && ToggleIcon}
              <button
                type="button"
                class="tab-file-toggle"
                data-no-tab-drag
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
            onclick={() => {
              if (!suppressSelect) onSelect?.(identity(tab));
            }}
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
            data-no-tab-drag
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
    <div class="flex items-center px-1">
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

{#if draggedTab && pointerDrag?.active}
  {@const PreviewIcon = draggedTab.icon}
  {@const PreviewSelectIcon = draggedTab.selectIcon}
  <div
    class="pointer-events-none fixed z-50 inline-grid h-8 grid-cols-[auto_minmax(0,1fr)_auto] border border-border bg-background text-foreground opacity-90 shadow-lg"
    style:top={`${pointerDrag.top}px`}
    style:left={`${previewLeft}px`}
    style:width={`${pointerDrag.width}px`}
    aria-hidden="true"
  >
    <div class="inline-grid h-8 w-5.5 place-items-center pl-1.5">
      {#if draggedTab.status?.tone}
        <StatusDot tone={draggedTab.status.tone} pulse={false} />
      {:else if PreviewIcon}
        <PreviewIcon size={12} strokeWidth={2.2} />
      {/if}
    </div>
    <div class="inline-flex h-8 min-w-0 items-center gap-1.5 px-1 text-xs">
      {#if PreviewSelectIcon}
        <PreviewSelectIcon size={12} strokeWidth={2.2} />
      {/if}
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
        >{draggedTab.label}</span
      >
    </div>
    <div class="w-5.5"></div>
  </div>
{/if}

<style>
/* Hidden overflow scrollbar for the tab rail (escape-hatch reason 2). */
.tab-scroller {
  scrollbar-width: none;
}

.tab-scroller::-webkit-scrollbar {
  display: none;
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
