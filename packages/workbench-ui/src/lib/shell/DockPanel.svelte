<script lang="ts">
import type { Snippet } from "svelte";
import DockDropIndicator from "./DockDropIndicator.svelte";
import DockTabStrip from "./DockTabStrip.svelte";
import {
  clearPanelViewDropTarget,
  endPanelViewDrag,
  PANEL_VIEW_MIME,
  setPanelViewDropTarget,
  shellDrag,
} from "./shell-drag.svelte.js";
import {
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
  panelView,
}: {
  dock: DockId;
  views: PanelViewDescriptor[];
  registry?: readonly PanelViewDescriptor[];
  activeViewId?: string;
  draggable?: boolean;
  buildMenuItems?: PanelViewMenuBuilder;
  onSelect?: (viewId: string) => void;
  onMove?: (viewId: string, target: PanelViewDropTarget) => void;
  onHide?: (viewId: string) => void;
  panelView: Snippet<[string]>;
} = $props();

const dragActive = $derived(Boolean(draggable && shellDrag.viewId && onMove));

function handleBodyDragOver(event: DragEvent) {
  if (!dragActive) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  setPanelViewDropTarget(dock, views.length);
}

function handleBodyDrop(event: DragEvent) {
  if (!dragActive) return;
  event.preventDefault();
  const viewId =
    shellDrag.viewId ?? event.dataTransfer?.getData(PANEL_VIEW_MIME);
  endPanelViewDrag();
  if (viewId) onMove?.(viewId, { dock, index: views.length });
}
</script>

<section class="dock-panel" data-dock={dock} aria-label={DOCK_LABELS[dock]}>
  <DockTabStrip
    {dock}
    {views}
    {registry}
    {activeViewId}
    {draggable}
    {buildMenuItems}
    {onSelect}
    {onMove}
    {onHide}
  />
  <div
    class="dock-body"
    role="presentation"
    ondragover={handleBodyDragOver}
    ondragleave={() => clearPanelViewDropTarget(dock)}
    ondrop={handleBodyDrop}
  >
    {#if activeViewId}
      {@render panelView(activeViewId)}
    {/if}
    {#if dragActive}
      <DockDropIndicator {dock} hovered={shellDrag.hoverDock === dock} />
    {/if}
  </div>
</section>
