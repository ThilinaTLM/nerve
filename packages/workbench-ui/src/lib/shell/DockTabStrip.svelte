<script lang="ts">
import EyeOff from "@lucide/svelte/icons/eye-off";
import MoveLeft from "@lucide/svelte/icons/move-left";
import MoveRight from "@lucide/svelte/icons/move-right";
import PanelBottom from "@lucide/svelte/icons/panel-bottom";
import PanelLeft from "@lucide/svelte/icons/panel-left";
import PanelRight from "@lucide/svelte/icons/panel-right";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
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
  closeLabel,
  buildMenuItems,
  onSelect,
  onMove,
  onHide,
  onClose,
}: {
  dock: DockId;
  views: PanelViewDescriptor[];
  /** Every registered view; used to name views dragged in from other docks. */
  registry?: readonly PanelViewDescriptor[];
  activeViewId?: string;
  /** Disabled in compact mode, where the context menu is the only move path. */
  draggable?: boolean;
  /** Renders a trailing close/collapse control when provided with `onClose`. */
  closeLabel?: string;
  buildMenuItems?: PanelViewMenuBuilder;
  onSelect?: (viewId: string) => void;
  onMove?: (viewId: string, target: PanelViewDropTarget) => void;
  onHide?: (viewId: string) => void;
  onClose?: () => void;
} = $props();

let strip = $state<HTMLDivElement | null>(null);
let announcement = $state("");

const dockIcons: Record<DockId, typeof PanelLeft> = {
  left: PanelLeft,
  right: PanelRight,
  bottom: PanelBottom,
};

const dragActive = $derived(Boolean(draggable && shellDrag.viewId));
const dropIndex = $derived(
  shellDrag.hoverDock === dock ? shellDrag.hoverIndex : undefined,
);

function dropIndexFor(event: DragEvent): number {
  if (!strip) return views.length;
  const tabs = [...strip.querySelectorAll<HTMLElement>("[data-view-id]")];
  for (const [index, tab] of tabs.entries()) {
    const rect = tab.getBoundingClientRect();
    if (event.clientX < rect.left + rect.width / 2) return index;
  }
  return tabs.length;
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
  setPanelViewDropTarget(dock, dropIndexFor(event));
}

function handleDrop(event: DragEvent) {
  if (!dragActive) return;
  event.preventDefault();
  const viewId =
    shellDrag.viewId ?? event.dataTransfer?.getData(PANEL_VIEW_MIME);
  const index = dropIndexFor(event);
  endPanelViewDrag();
  if (!viewId) return;
  move(viewId, { dock, index });
}

function defaultMenu(
  view: PanelViewDescriptor,
  index: number,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = DOCK_IDS.map((target) => ({
    label: `Move to ${DOCK_LABELS[target]}`,
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
      label: "Move Left",
      icon: MoveLeft,
      disabled: index === 0 || !onMove,
      onSelect: () => move(view.id, { dock, index: index - 1 }),
    },
    {
      label: "Move Right",
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
</script>

<div
  class="dock-tab-strip"
  class:drag-active={dragActive}
  bind:this={strip}
  role="presentation"
  ondragover={handleDragOver}
  ondragleave={() => clearPanelViewDropTarget(dock)}
  ondrop={handleDrop}
>
  <div
    class="dock-tabs"
    role="tablist"
    aria-label={`${DOCK_LABELS[dock]} views`}
  >
    {#each views as view, index (view.id)}
      {@const Icon = view.icon}
      <ContextMenu items={menuItems(view, index)} triggerClass="contents">
        <button
          type="button"
          class="dock-tab"
          class:active={view.id === activeViewId}
          class:dragging={shellDrag.viewId === view.id}
          class:drop-before={dropIndex === index}
          data-view-id={view.id}
          role="tab"
          aria-selected={view.id === activeViewId}
          aria-label={view.title}
          title={view.title}
          draggable={draggable && Boolean(onMove)}
          ondragstart={(event) => {
            if (!onMove) return;
            beginPanelViewDrag(view.id);
            event.dataTransfer?.setData(PANEL_VIEW_MIME, view.id);
            event.dataTransfer?.setData("text/plain", view.title);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          }}
          ondragend={endPanelViewDrag}
          onclick={() => onSelect?.(view.id)}
        >
          <Icon size={14} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </ContextMenu>
    {/each}
    {#if dragActive && dropIndex !== undefined && dropIndex >= views.length}
      <span class="dock-tab-drop-end" aria-hidden="true"></span>
    {/if}
  </div>
  {#if onClose}
    <div class="dock-tab-actions">
      <Button
        variant="ghost"
        size="icon-xs"
        ariaLabel={closeLabel ?? `Hide ${DOCK_LABELS[dock].toLowerCase()}`}
        title={closeLabel ?? `Hide ${DOCK_LABELS[dock].toLowerCase()}`}
        onclick={onClose}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  {/if}
  <span class="sr-only" aria-live="polite">{announcement}</span>
</div>
