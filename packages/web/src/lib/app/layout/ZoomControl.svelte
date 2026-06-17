<script lang="ts">
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import { Button } from "$lib/components/ui/button";
  import Popover from "$lib/components/ui/popover-panel";
  import {
    MAX_ZOOM_LEVEL,
    MIN_ZOOM_LEVEL,
    clampZoomLevel,
    zoomPercentForLevel,
  } from "./layout-state.svelte";

  type Props = {
    zoomLevel?: number;
    onZoomLevelChange?: (level: number) => void;
  };

  let { zoomLevel = 0, onZoomLevelChange }: Props = $props();

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

  function handleRangeInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    setZoomLevel(Number(input.value));
  }
</script>

<Popover
  class="zoom-popover"
  triggerClass="zoom-trigger-wrap"
  ariaLabel="Open zoom controls"
  side="top"
  align="end"
>
  {#snippet trigger()}
    <span class="zoom-trigger" title={`Zoom: ${zoomPercent}%`}>
      <span>{zoomPercent}%</span>
    </span>
  {/snippet}

  <div class="zoom-card">
    <header>
      <div>
        <strong>Zoom</strong>
        <span>Zoom level {zoomLevelLabel}</span>
      </div>
      <span class="zoom-percent">{zoomPercent}%</span>
    </header>

    <div class="zoom-actions" aria-label="Zoom controls">
      <Button
        variant="outline"
        size="icon-sm"
        ariaLabel="Zoom out"
        title="Zoom out"
        disabled={clampedZoomLevel <= MIN_ZOOM_LEVEL}
        onclick={() => changeZoomLevel(-1)}
      >
        <ZoomOut size={14} strokeWidth={2.1} aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        ariaLabel="Reset zoom"
        title="Reset zoom"
        disabled={clampedZoomLevel === 0}
        onclick={() => setZoomLevel(0)}
      >
        <RotateCcw size={14} strokeWidth={2.1} aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        ariaLabel="Zoom in"
        title="Zoom in"
        disabled={clampedZoomLevel >= MAX_ZOOM_LEVEL}
        onclick={() => changeZoomLevel(1)}
      >
        <ZoomIn size={14} strokeWidth={2.1} aria-hidden="true" />
      </Button>
    </div>

    <label class="zoom-slider">
      <span>Level</span>
      <input
        type="range"
        min={MIN_ZOOM_LEVEL}
        max={MAX_ZOOM_LEVEL}
        step="1"
        value={clampedZoomLevel}
        aria-label="Zoom level"
        oninput={handleRangeInput}
      />
      <span class="zoom-range-labels" aria-hidden="true">
        <span>{MIN_ZOOM_LEVEL}</span>
        <span>0</span>
        <span>+{MAX_ZOOM_LEVEL}</span>
      </span>
    </label>
  </div>
</Popover>

<style>
  .zoom-trigger {
    display: inline-flex;
    align-items: center;
    height: 100%;
    padding: 0 0.6rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  :global(.zoom-trigger-wrap) {
    height: 100%;
  }

  :global(.zoom-trigger-wrap:hover),
  :global(.zoom-trigger-wrap[data-state="open"]) {
    background: var(--accent);
  }

  :global(.zoom-trigger-wrap:hover) .zoom-trigger,
  :global(.zoom-trigger-wrap[data-state="open"]) .zoom-trigger {
    color: var(--foreground);
  }

  :global(.zoom-popover) {
    width: min(18rem, calc(100vw - 1.5rem));
  }

  .zoom-card {
    display: grid;
    gap: 0.75rem;
    padding: 0.75rem;
  }

  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 0.8rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding-bottom: 0.65rem;
  }

  header div {
    display: grid;
    gap: 0.12rem;
  }

  header strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  header span,
  .zoom-slider > span {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .zoom-percent {
    flex: none;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .zoom-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.4rem;
  }

  .zoom-actions :global(button) {
    width: 100%;
  }

  .zoom-slider {
    display: grid;
    gap: 0.4rem;
  }

  .zoom-slider input {
    width: 100%;
    accent-color: var(--primary);
  }

  .zoom-range-labels {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono);
  }
</style>
