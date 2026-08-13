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
const sideResizerClass =
  "bg-card hover:bg-card data-[active=keyboard]:bg-card data-[active=pointer]:bg-card after:pointer-events-none after:absolute after:top-8 after:bottom-0 after:left-0 after:w-px after:bg-border after:content-[''] before:pointer-events-none before:absolute before:top-8 before:left-0 before:h-px before:w-px before:-translate-y-px before:bg-primary before:content-['']";

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
        <Sheet.Content
          side="left"
          class="sheet-pane"
          swipeToDismiss
          onSwipeDismiss={() => actions.onSheetOpenChange?.("primary", false)}
        >
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
        <Sheet.Content
          side="right"
          class="sheet-pane"
          swipeToDismiss
          onSwipeDismiss={() => actions.onSheetOpenChange?.("secondary", false)}
        >
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
                {panelView}
              />
            </Pane>
            <PaneResizer
              class={sideResizerClass}
              aria-label="Resize left panel"
            />
          {/if}

          <!-- The editor consumes the space left by the persisted side docks. -->
          <Pane minSize={25} order={2}>
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
                      {panelView}
                    />
                  </Pane>
                {/if}
              </PaneGroup>
            {/key}
          </Pane>

          {#if rightVisible}
            <PaneResizer
              class={sideResizerClass}
              aria-label="Resize right panel"
            />
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

<style>
.workspace-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--sidebar);
}

/* paneforge renders the pane group DOM (escape-hatch reason 5). */
.workspace-shell :global([data-pane-group]) {
  width: 100%;
  height: 100%;
}

/* EditorArea owns the tab/content rows; the shell only stretches it. */
.workbench-editor-area {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  background: var(--background);
}

/* Compact (< 1024px): the editor fills the shell; docks move into sheets. */
.workspace-shell.compact {
  display: block;
}

/* Collapsed or empty docks are not mounted; this edge strip keeps them a
   reachable drop target. */
.dock-drop-strip {
  position: absolute;
  z-index: 20;
  display: grid;
  place-items: center;
  border: 2px dashed color-mix(in oklab, var(--primary) 45%, transparent);
  background: color-mix(in oklab, var(--primary) 8%, transparent);
}

.dock-drop-strip.hovered {
  border-style: solid;
  background: color-mix(in oklab, var(--primary) 18%, transparent);
}

.dock-drop-strip[data-dock="left"] {
  inset-block: 0;
  left: 0;
  width: 3rem;
}

.dock-drop-strip[data-dock="right"] {
  inset-block: 0;
  right: 0;
  width: 3rem;
}

.dock-drop-strip[data-dock="bottom"] {
  inset-inline: 0;
  bottom: 0;
  height: 3rem;
}

.dock-drop-strip .dock-drop-label {
  color: var(--primary);
  font-size: var(--text-xs);
  writing-mode: horizontal-tb;
  text-align: center;
}
</style>
