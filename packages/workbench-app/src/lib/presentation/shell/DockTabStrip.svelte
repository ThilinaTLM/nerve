<script lang="ts">
import EyeOff from "@lucide/svelte/icons/eye-off";
import MoveLeft from "@lucide/svelte/icons/move-left";
import MoveRight from "@lucide/svelte/icons/move-right";
import PanelBottom from "@lucide/svelte/icons/panel-bottom";
import PanelLeft from "@lucide/svelte/icons/panel-left";
import PanelRight from "@lucide/svelte/icons/panel-right";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/ui/context-menu-list";
import {
  beginPanelViewDrag,
  clearPanelViewDropTarget,
  endPanelViewDrag,
  PANEL_VIEW_MIME,
  setPanelViewDropTarget,
  shellDrag,
} from "./shell-drag.svelte.js";
import {
  adjacentTabIndexAtOverlap,
  initialTabIndexAtOverlap,
} from "./horizontal-tab-reorder.js";
import {
  DOCK_IDS,
  DOCK_LABELS,
  type DockId,
  type PanelViewDescriptor,
  type PanelViewDropTarget,
  type PanelViewMenuBuilder,
} from "./shell-types.js";

let {
  dock,
  views,
  registry = views,
  activeViewId,
  draggable = true,
  buildMenuItems,
  onSelect,
  onMove,
  onHide,
}: {
  dock: DockId;
  views: PanelViewDescriptor[];
  /** Every registered view; used to name views dragged in from other docks. */
  registry?: readonly PanelViewDescriptor[];
  activeViewId?: string;
  /** Disabled in compact mode, where the context menu is the only move path. */
  draggable?: boolean;
  buildMenuItems?: PanelViewMenuBuilder;
  onSelect?: (viewId: string) => void;
  onMove?: (viewId: string, target: PanelViewDropTarget) => void;
  onHide?: (viewId: string) => void;
} = $props();

let strip = $state<HTMLDivElement | null>(null);
let announcement = $state("");
let collapsedDragViewId = $state<string | undefined>();
let collapseFrame: number | undefined;

const dockIcons: Record<DockId, typeof PanelLeft> = {
  left: PanelLeft,
  right: PanelRight,
  bottom: PanelBottom,
};

const dragActive = $derived(Boolean(draggable && shellDrag.viewId));
const dropIndex = $derived(
  shellDrag.hoverDock === dock ? shellDrag.hoverIndex : undefined,
);
const remainingViews = $derived(
  views.filter((view) => view.id !== shellDrag.viewId),
);

function tabBounds() {
  if (!strip) return [];
  return [...strip.querySelectorAll<HTMLElement>("[data-view-id]")]
    .filter((tab) => tab.dataset.viewId !== shellDrag.viewId)
    .map((tab) => {
      const rect = tab.getBoundingClientRect();
      return {
        key: tab.dataset.viewId ?? "",
        left: rect.left,
        width: rect.width,
      };
    });
}

function updateDropIndex(event: DragEvent): number | undefined {
  const viewId = shellDrag.viewId;
  const draggedWidth = shellDrag.draggedWidth;
  const pointerOffsetX = shellDrag.pointerOffsetX;
  if (!viewId || draggedWidth === undefined || pointerOffsetX === undefined)
    return undefined;

  const direction = Math.sign(
    event.clientX - (shellDrag.previousX ?? event.clientX),
  ) as -1 | 0 | 1;
  shellDrag.previousX = event.clientX;
  const draggedLeft = event.clientX - pointerOffsetX;
  const remainingTabs = tabBounds();

  if (shellDrag.hoverDock !== dock || shellDrag.hoverIndex === undefined) {
    return initialTabIndexAtOverlap({
      draggedLeft,
      draggedWidth,
      direction: 0,
      remainingTabs,
    });
  }

  const orderedKeys = remainingViews.map((view) => view.id);
  const currentIndex = Math.max(
    0,
    Math.min(shellDrag.hoverIndex, orderedKeys.length),
  );
  orderedKeys.splice(currentIndex, 0, viewId);
  return adjacentTabIndexAtOverlap({
    draggedKey: viewId,
    orderedKeys,
    draggedLeft,
    draggedWidth,
    direction,
    remainingTabs,
  });
}

function move(viewId: string, target: PanelViewDropTarget) {
  onMove?.(viewId, target);
  const title = registry.find((view) => view.id === viewId)?.title ?? "Panel";
  const dockLabel = DOCK_LABELS[target.dock].toLowerCase();
  announcement =
    target.dock === dock
      ? `${title} moved to ${dockLabel}, position ${target.index + 1}`
      : `${title} moved to ${dockLabel}`;
}

function handleDragOver(event: DragEvent) {
  if (!dragActive) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const index = updateDropIndex(event);
  if (index !== undefined) setPanelViewDropTarget(dock, index);
}

function finishDrag() {
  if (collapseFrame !== undefined) cancelAnimationFrame(collapseFrame);
  collapseFrame = undefined;
  collapsedDragViewId = undefined;
  endPanelViewDrag();
}

function handleDragLeave(event: DragEvent) {
  if (strip?.contains(event.relatedTarget as Node | null)) return;
  clearPanelViewDropTarget(dock);
}

function handleDrop(event: DragEvent) {
  if (!dragActive) return;
  event.preventDefault();
  const viewId =
    shellDrag.viewId ?? event.dataTransfer?.getData(PANEL_VIEW_MIME);
  const index = shellDrag.hoverDock === dock ? shellDrag.hoverIndex : undefined;
  endPanelViewDrag();
  if (!viewId || index === undefined) return;
  move(viewId, { dock, index });
}

function defaultMenu(
  view: PanelViewDescriptor,
  index: number,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = DOCK_IDS.map((target) => ({
    label: `Move to ${DOCK_LABELS[target].toLowerCase()}`,
    icon: dockIcons[target],
    disabled: target === dock || !onMove,
    onSelect: () =>
      move(view.id, {
        dock: target,
        index: target === dock ? index : Number.MAX_SAFE_INTEGER,
      }),
  }));
  items.push(
    { type: "separator" },
    {
      label: "Move left",
      icon: MoveLeft,
      disabled: index === 0 || !onMove,
      onSelect: () => move(view.id, { dock, index: index - 1 }),
    },
    {
      label: "Move right",
      icon: MoveRight,
      disabled: index >= views.length - 1 || !onMove,
      onSelect: () => move(view.id, { dock, index: index + 1 }),
    },
  );
  if (view.hideable !== false && onHide) {
    items.push(
      { type: "separator" },
      {
        label: `Hide "${view.title}"`,
        icon: EyeOff,
        onSelect: () => onHide(view.id),
      },
    );
  }
  return items;
}

function menuItems(
  view: PanelViewDescriptor,
  index: number,
): ContextMenuItem[] {
  const defaultItems = defaultMenu(view, index);
  return (
    buildMenuItems?.({ view, dock, index, views, defaultItems }) ?? defaultItems
  );
}

const tourIdByView: Record<string, string> = {
  conversations: "conversations-tab",
  files: "files-panel",
  tasks: "tasks-panel",
  notes: "scratch-notes-panel",
  git: "git-workflow",
  "pull-requests": "pull-request-workflow",
  context: "context-panel",
};
</script>

<div
  class="dock-tab-strip"
  class:drag-active={dragActive}
  data-tour-id={dock === "left" ? "panel-layout" : undefined}
  bind:this={strip}
  role="presentation"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <div
    class="dock-tabs"
    role="tablist"
    aria-label={`${DOCK_LABELS[dock]} views`}
  >
    {#each views as view, index (view.id)}
      {@const Icon = view.icon}
      {@const remainingIndex = remainingViews.findIndex(
        (candidate) => candidate.id === view.id,
      )}
      {#if view.id !== shellDrag.viewId && dropIndex === remainingIndex}
        <span
          class="inline-block h-8 w-8 flex-none rounded-t-md border border-b-0 border-primary/55 bg-primary/10 shadow-inner"
          aria-hidden="true"
        ></span>
      {/if}
      <ContextMenu items={menuItems(view, index)} triggerClass="contents">
        <button
          type="button"
          class={`dock-tab ${index > 0 ? "-ml-px" : ""}`}
          class:active={view.id === activeViewId}
          class:dragging={collapsedDragViewId === view.id}
          data-view-id={view.id}
          data-tour-id={tourIdByView[view.id]}
          role="tab"
          aria-selected={view.id === activeViewId}
          aria-label={view.title}
          title={view.title}
          draggable={draggable && Boolean(onMove)}
          ondragstart={(event) => {
            if (!onMove) return;
            const rect = event.currentTarget.getBoundingClientRect();
            beginPanelViewDrag(
              view.id,
              dock,
              event.clientX - rect.left,
              rect.width,
              event.clientX,
            );
            setPanelViewDropTarget(dock, index);
            event.dataTransfer?.setDragImage(
              event.currentTarget,
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
            event.dataTransfer?.setData(PANEL_VIEW_MIME, view.id);
            event.dataTransfer?.setData("text/plain", view.title);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            collapseFrame = requestAnimationFrame(() => {
              collapsedDragViewId = view.id;
              collapseFrame = undefined;
            });
          }}
          ondragend={finishDrag}
          onclick={() => onSelect?.(view.id)}
        >
          <Icon size={14} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </ContextMenu>
    {/each}
    {#if dragActive && dropIndex !== undefined && dropIndex >= remainingViews.length}
      <span
        class="inline-block h-8 w-8 flex-none rounded-t-md border border-b-0 border-primary/55 bg-primary/10 shadow-inner"
        aria-hidden="true"
      ></span>
    {/if}
  </div>
  <span class="sr-only" aria-live="polite">{announcement}</span>
</div>

<style>
.dock-tab-strip {
  position: relative;
  display: flex;
  align-items: stretch;
  min-width: 0;
  height: 2rem;
  background: var(--card);
}

/* Keep the rail divider behind the active tab so that tab joins the panel. */
.dock-tab-strip::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  height: 1px;
  background: var(--primary);
  pointer-events: none;
}

.dock-tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  /* Escape-hatch reason 2: a scrollbar in a 2rem icon rail is unusable. */
  scrollbar-width: none;
}

.dock-tabs::-webkit-scrollbar {
  display: none;
}

.dock-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 2rem;
  height: 2rem;
  border: 1px solid color-mix(in oklab, var(--border) 62%, transparent);
  border-bottom: 0;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  color: var(--muted-foreground);
  cursor: pointer;
}

.dock-tab:hover {
  background: color-mix(in oklab, var(--accent) 60%, transparent);
  color: var(--foreground);
}

.dock-tab.active {
  z-index: 2;
  border-color: var(--primary);
  background: var(--card);
  color: var(--foreground);
}

.dock-tab.dragging {
  width: 0;
  border: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
</style>
