<script lang="ts">
import PanelBottom from "@lucide/svelte/icons/panel-bottom";
import PanelLeft from "@lucide/svelte/icons/panel-left";
import PanelRight from "@lucide/svelte/icons/panel-right";
import PanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import ZoomIn from "@lucide/svelte/icons/zoom-in";
import ZoomOut from "@lucide/svelte/icons/zoom-out";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Kbd } from "@nervekit/ui-kit/components/ui/kbd";
import Popover, {
  PopoverBody,
  PopoverHeader,
  PopoverRow,
  PopoverSection,
} from "@nervekit/ui-kit/components/ui/popover-panel";
import { formatShortcut } from "$lib/core/shortcuts/keyboard";
import {
  getShortcut,
  type ShortcutCommandId,
} from "$lib/core/shortcuts/registry";
import {
  DOCK_LABELS,
  type DockId,
  type DockToggle,
} from "$lib/presentation/shell";
import {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  clampZoomLevel,
  zoomPercentForLevel,
} from "./appearance.svelte";

type Props = {
  zoomLevel?: number;
  dockToggles?: DockToggle[];
  onZoomLevelChange?: (level: number) => void;
};

let { zoomLevel = 0, dockToggles = [], onZoomLevelChange }: Props = $props();

const dockIcons = {
  left: PanelLeft,
  right: PanelRight,
  bottom: PanelBottom,
} as const;

const dockCommandIds: Record<DockId, ShortcutCommandId> = {
  left: "view.toggleLeftDock",
  right: "view.toggleRightDock",
  bottom: "view.toggleBottomDock",
};

function dockShortcut(dock: DockId): string | undefined {
  const command = getShortcut(dockCommandIds[dock]);
  return command ? formatShortcut(command.defaultBinding) : undefined;
}

const clampedZoomLevel = $derived(clampZoomLevel(zoomLevel));
const zoomPercent = $derived(zoomPercentForLevel(clampedZoomLevel));
const zoomLevelLabel = $derived(
  clampedZoomLevel > 0 ? `+${clampedZoomLevel}` : String(clampedZoomLevel),
);

function setZoomLevel(level: number) {
  onZoomLevelChange?.(clampZoomLevel(level));
}

function changeZoomLevel(delta: number) {
  setZoomLevel(clampedZoomLevel + delta);
}
</script>

<Popover
  size="md"
  triggerClass="h-5.5 rounded-sm px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
  ariaLabel="Open layout controls"
  side="top"
  align="end"
>
  {#snippet trigger()}
    <span class="layout-trigger" title={`Layout · Zoom ${zoomPercent}%`}>
      <PanelsTopLeft size={12} strokeWidth={2.1} aria-hidden="true" />
      <span>{zoomPercent}%</span>
    </span>
  {/snippet}

  <PopoverBody>
    <PopoverHeader title="Layout">
      {#snippet action()}
        <span class="flex-none text-sm font-semibold tabular-nums"
          >{zoomPercent}%</span
        >
      {/snippet}
    </PopoverHeader>

    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1" aria-label="Zoom controls">
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel="Zoom out"
          title="Zoom out"
          disabled={clampedZoomLevel <= MIN_ZOOM_LEVEL}
          onclick={() => changeZoomLevel(-1)}
        >
          <ZoomOut class="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel="Reset zoom"
          title="Reset zoom"
          disabled={clampedZoomLevel === 0}
          onclick={() => setZoomLevel(0)}
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          ariaLabel="Zoom in"
          title="Zoom in"
          disabled={clampedZoomLevel >= MAX_ZOOM_LEVEL}
          onclick={() => changeZoomLevel(1)}
        >
          <ZoomIn class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <span class="text-muted-foreground">Zoom level {zoomLevelLabel}</span>
    </div>

    <PopoverSection label="Panels" separated>
      {#each dockToggles as toggle (toggle.dock)}
        {@const Icon = dockIcons[toggle.dock]}
        {@const shortcut = dockShortcut(toggle.dock)}
        <PopoverRow
          label={DOCK_LABELS[toggle.dock]}
          selected={toggle.open}
          onclick={toggle.onToggle}
        >
          {#snippet icon()}
            <Icon
              class="size-4 flex-none text-muted-foreground"
              aria-hidden="true"
            />
          {/snippet}
          {#snippet trailing()}
            {#if shortcut}
              <Kbd class="flex-none">{shortcut}</Kbd>
            {/if}
          {/snippet}
        </PopoverRow>
      {/each}
    </PopoverSection>
  </PopoverBody>
</Popover>

<style>
.layout-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-variant-numeric: tabular-nums;
}
</style>
