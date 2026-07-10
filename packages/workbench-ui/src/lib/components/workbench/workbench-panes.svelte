<script lang="ts">
import type { Snippet } from "svelte";
import {
  Handle as PaneResizer,
  Pane,
  PaneGroup,
} from "@nervekit/ui-kit/components/ui/resizable";
import * as Sheet from "@nervekit/ui-kit/components/ui/sheet";

type PaneSize = {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
};

let {
  compact = false,
  sidebarCollapsed = false,
  utilityCollapsed = false,
  navDrawerOpen = false,
  utilityDrawerOpen = false,
  autoSaveId = "nerve.workbench.workspace",
  keyboardResizeBy = 8,
  leftLabel = "Navigator",
  rightLabel = "Utility panel",
  leftSize = { defaultSize: 19, minSize: 14, maxSize: 32 },
  centerSize = { defaultSize: 57, minSize: 38 },
  rightSize = { defaultSize: 24, minSize: 19, maxSize: 40 },
  onNavDrawerOpenChange,
  onUtilityDrawerOpenChange,
  left,
  center,
  right,
}: {
  compact?: boolean;
  sidebarCollapsed?: boolean;
  utilityCollapsed?: boolean;
  navDrawerOpen?: boolean;
  utilityDrawerOpen?: boolean;
  autoSaveId?: string;
  keyboardResizeBy?: number;
  leftLabel?: string;
  rightLabel?: string;
  leftSize?: PaneSize;
  centerSize?: PaneSize;
  rightSize?: PaneSize;
  onNavDrawerOpenChange?: (open: boolean) => void;
  onUtilityDrawerOpenChange?: (open: boolean) => void;
  left: Snippet;
  center: Snippet;
  right: Snippet;
} = $props();
</script>

{#if compact}
  <div class="workspace-shell compact">
    <div class="pane-shell center-shell">
      {@render center()}
    </div>
  </div>

  <Sheet.Root open={navDrawerOpen} onOpenChange={onNavDrawerOpenChange}>
    <Sheet.Content side="left" class="sheet-pane">
      <Sheet.Title class="sr-only">{leftLabel}</Sheet.Title>
      <div class="pane-shell navigator-pane">
        {@render left()}
      </div>
    </Sheet.Content>
  </Sheet.Root>

  <Sheet.Root open={utilityDrawerOpen} onOpenChange={onUtilityDrawerOpenChange}>
    <Sheet.Content side="right" class="sheet-pane">
      <Sheet.Title class="sr-only">{rightLabel}</Sheet.Title>
      <div class="pane-shell utility-shell">
        {@render right()}
      </div>
    </Sheet.Content>
  </Sheet.Root>
{:else}
  <div class="workspace-shell">
    <PaneGroup direction="horizontal" {autoSaveId} {keyboardResizeBy}>
      {#if !sidebarCollapsed}
        <Pane
          defaultSize={leftSize.defaultSize}
          minSize={leftSize.minSize}
          maxSize={leftSize.maxSize}
          order={1}
        >
          <div class="pane-shell navigator-pane">
            {@render left()}
          </div>
        </Pane>
        <PaneResizer aria-label={`Resize ${leftLabel.toLowerCase()}`} />
      {/if}

      <Pane
        defaultSize={centerSize.defaultSize}
        minSize={centerSize.minSize}
        order={2}
      >
        <div class="pane-shell center-shell">
          {@render center()}
        </div>
      </Pane>

      {#if !utilityCollapsed}
        <PaneResizer aria-label={`Resize ${rightLabel.toLowerCase()}`} />
        <Pane
          defaultSize={rightSize.defaultSize}
          minSize={rightSize.minSize}
          maxSize={rightSize.maxSize}
          order={3}
        >
          <div class="pane-shell utility-shell">
            {@render right()}
          </div>
        </Pane>
      {/if}
    </PaneGroup>
  </div>
{/if}
