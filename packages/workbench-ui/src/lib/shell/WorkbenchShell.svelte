<script lang="ts">
import type { Snippet } from "svelte";
import {
  Handle as PaneResizer,
  Pane,
  PaneGroup,
} from "@nervekit/ui-kit/components/ui/resizable";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";
import DockPanel from "./DockPanel.svelte";
import DockTabStrip from "./DockTabStrip.svelte";
import {
  clearPanelViewDropTarget,
  endPanelViewDrag,
  PANEL_VIEW_MIME,
  setPanelViewDropTarget,
  shellDrag,
} from "./shell-drag.svelte.js";
import {
  DOCK_SIZE_LIMITS,
  dockDescriptors,
  isDockVisible,
} from "./shell-layout.js";
import {
  DOCK_LABELS,
  type DockId,
  type PanelViewDescriptor,
  type ShellActions,
  type ShellLayout,
} from "./shell-types.js";
import WorkbenchFrame from "./WorkbenchFrame.svelte";

let {
  layout,
  descriptors,
  compact = false,
  primarySheetOpen = false,
  secondarySheetOpen = false,
  keyboardResizeBy = 8,
  actions = {},
  titlebar: titlebarContent,
  editor: editorContent,
  panelView,
  statusBar: statusBarContent,
  overlays,
}: {
  layout: ShellLayout;
  descriptors: readonly PanelViewDescriptor[];
  compact?: boolean;
  primarySheetOpen?: boolean;
  secondarySheetOpen?: boolean;
  keyboardResizeBy?: number;
  actions?: ShellActions;
  titlebar: Snippet;
  editor: Snippet;
  /** Renders the body of a panel view by id. */
  panelView: Snippet<[string]>;
  statusBar: Snippet;
  overlays?: Snippet;
} = $props();

const leftViews = $derived(dockDescriptors(layout, "left", descriptors));
const rightViews = $derived(dockDescriptors(layout, "right", descriptors));
const bottomViews = $derived(dockDescriptors(layout, "bottom", descriptors));

const leftVisible = $derived(!compact && isDockVisible(layout, "left"));
const rightVisible = $derived(!compact && isDockVisible(layout, "right"));
const bottomVisible = $derived(!compact && isDockVisible(layout, "bottom"));

// Compact mode folds the docks into two sheets: the left dock is primary, the
// right and bottom docks share the secondary sheet.
const secondaryViews = $derived([...rightViews, ...bottomViews]);
let secondaryActiveId = $state<string | undefined>();
const secondaryActive = $derived(
  secondaryActiveId && secondaryViews.some((v) => v.id === secondaryActiveId)
    ? secondaryActiveId
    : secondaryViews[0]?.id,
);

function selectSecondary(viewId: string) {
  secondaryActiveId = viewId;
  actions.onActivateView?.(viewId);
}

// Collapsed and empty docks are not rendered, so a drag in flight exposes a
// thin edge strip that accepts the drop and expands the dock.
const dragActive = $derived(!compact && Boolean(shellDrag.viewId));

function dropOnStrip(event: DragEvent, dock: DockId) {
  event.preventDefault();
  const viewId =
    shellDrag.viewId ?? event.dataTransfer?.getData(PANEL_VIEW_MIME);
  endPanelViewDrag();
  if (viewId)
    actions.onMoveView?.(viewId, { dock, index: Number.MAX_SAFE_INTEGER });
}
</script>

{#snippet dropStrip(dock: DockId)}
  <div
    class="dock-drop-strip"
    class:hovered={shellDrag.hoverDock === dock}
    data-dock={dock}
    role="presentation"
    ondragover={(event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setPanelViewDropTarget(dock, Number.MAX_SAFE_INTEGER);
    }}
    ondragleave={() => clearPanelViewDropTarget(dock)}
    ondrop={(event) => dropOnStrip(event, dock)}
  >
    <span class="dock-drop-label">{DOCK_LABELS[dock]}</span>
  </div>
{/snippet}

<WorkbenchFrame>
  {#snippet titlebar()}{@render titlebarContent()}{/snippet}
  {#snippet workspace()}
    {#if compact}
      <div class="workspace-shell compact">
        <div class="workbench-editor-area">{@render editorContent()}</div>
      </div>

      <Sheet.Root
        open={primarySheetOpen}
        onOpenChange={(open) => actions.onSheetOpenChange?.("primary", open)}
      >
        <Sheet.Content side="left" class="sheet-pane">
          <Sheet.Title class="sr-only">{DOCK_LABELS.left}</Sheet.Title>
          <DockPanel
            dock="left"
            views={leftViews}
            registry={descriptors}
            activeViewId={layout.docks.left.activeViewId}
            draggable={false}
            onSelect={actions.onActivateView}
            onMove={actions.onMoveView}
            onHide={actions.onHideView}
            {panelView}
          />
        </Sheet.Content>
      </Sheet.Root>

      <Sheet.Root
        open={secondarySheetOpen}
        onOpenChange={(open) => actions.onSheetOpenChange?.("secondary", open)}
      >
        <Sheet.Content side="right" class="sheet-pane">
          <Sheet.Title class="sr-only">Panels</Sheet.Title>
          <section class="dock-panel" data-dock="right" aria-label="Panels">
            <DockTabStrip
              dock="right"
              views={secondaryViews}
              registry={descriptors}
              activeViewId={secondaryActive}
              draggable={false}
              onSelect={selectSecondary}
              onMove={actions.onMoveView}
              onHide={actions.onHideView}
            />
            <div class="dock-body">
              {#if secondaryActive}
                {@render panelView(secondaryActive)}
              {/if}
            </div>
          </section>
        </Sheet.Content>
      </Sheet.Root>
    {:else}
      <div class="workspace-shell">
        <PaneGroup direction="horizontal" {keyboardResizeBy}>
          {#if leftVisible}
            <Pane
              defaultSize={layout.docks.left.size}
              minSize={DOCK_SIZE_LIMITS.left.min}
              maxSize={DOCK_SIZE_LIMITS.left.max}
              order={1}
              onResize={(size) => actions.onDockResize?.("left", size)}
            >
              <DockPanel
                dock="left"
                views={leftViews}
                registry={descriptors}
                activeViewId={layout.docks.left.activeViewId}
                onSelect={actions.onActivateView}
                onMove={actions.onMoveView}
                onHide={actions.onHideView}
                onClose={() => actions.onToggleDock?.("left")}
                {panelView}
              />
            </Pane>
            <PaneResizer aria-label="Resize left panel" />
          {/if}

          <Pane defaultSize={57} minSize={25} order={2}>
            {#key bottomVisible}
              <PaneGroup direction="vertical" {keyboardResizeBy}>
                <Pane
                  defaultSize={100 -
                    (bottomVisible ? layout.docks.bottom.size : 0)}
                  minSize={25}
                  order={1}
                >
                  <div class="workbench-editor-area">
                    {@render editorContent()}
                  </div>
                </Pane>
                {#if bottomVisible}
                  <PaneResizer aria-label="Resize bottom panel" />
                  <Pane
                    defaultSize={layout.docks.bottom.size}
                    minSize={DOCK_SIZE_LIMITS.bottom.min}
                    maxSize={DOCK_SIZE_LIMITS.bottom.max}
                    order={2}
                    onResize={(size) => actions.onDockResize?.("bottom", size)}
                  >
                    <DockPanel
                      dock="bottom"
                      views={bottomViews}
                      registry={descriptors}
                      activeViewId={layout.docks.bottom.activeViewId}
                      onSelect={actions.onActivateView}
                      onMove={actions.onMoveView}
                      onHide={actions.onHideView}
                      onClose={() => actions.onToggleDock?.("bottom")}
                      {panelView}
                    />
                  </Pane>
                {/if}
              </PaneGroup>
            {/key}
          </Pane>

          {#if rightVisible}
            <PaneResizer aria-label="Resize right panel" />
            <Pane
              defaultSize={layout.docks.right.size}
              minSize={DOCK_SIZE_LIMITS.right.min}
              maxSize={DOCK_SIZE_LIMITS.right.max}
              order={3}
              onResize={(size) => actions.onDockResize?.("right", size)}
            >
              <DockPanel
                dock="right"
                views={rightViews}
                registry={descriptors}
                activeViewId={layout.docks.right.activeViewId}
                onSelect={actions.onActivateView}
                onMove={actions.onMoveView}
                onHide={actions.onHideView}
                onClose={() => actions.onToggleDock?.("right")}
                {panelView}
              />
            </Pane>
          {/if}
        </PaneGroup>
        {#if dragActive}
          {#if !leftVisible}{@render dropStrip("left")}{/if}
          {#if !rightVisible}{@render dropStrip("right")}{/if}
          {#if !bottomVisible}{@render dropStrip("bottom")}{/if}
        {/if}
      </div>
    {/if}
    {#if overlays}{@render overlays()}{/if}
  {/snippet}
  {#snippet footer()}{@render statusBarContent()}{/snippet}
</WorkbenchFrame>
