<script lang="ts">
/** Persistent tail activity row for an agent run: comet spinner, rolling
 * run-state label, elapsed timer, retry countdown and a brief completion cue.
 * Everything shown is derived from run state by `deriveRunActivity`; this
 * component only renders it. */
import Check from "@lucide/svelte/icons/check";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Square from "@lucide/svelte/icons/square";
import Terminal from "@lucide/svelte/icons/terminal";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { StatusDot } from "@nervekit/ui-kit/components/composites/status-dot";
import { cubicOut } from "svelte/easing";
import { prefersReducedMotion } from "svelte/motion";
import type { PendingWorkItem, RunActivityView } from "./run-activity";

let {
  view,
  onOpenPending,
  onRetryResponse,
  retrying = false,
}: {
  view: RunActivityView;
  /** Opens the agents popover; sub-agent chips may navigate to the agent. */
  onOpenPending?: (item: PendingWorkItem) => void;
  /** Cancels only the stalled provider request and retries it. */
  onRetryResponse?: () => void;
  /** A retry request is in flight; blocks duplicate clicks. */
  retrying?: boolean;
} = $props();

/** Chips beyond this collapse into a "+N" overflow chip. */
const MAX_CHIPS = 4;
const chips = $derived((view.pending ?? []).slice(0, MAX_CHIPS));
const overflow = $derived(Math.max(0, (view.pending?.length ?? 0) - MAX_CHIPS));

const RING_RADIUS = 6.5;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const COMET_ARC = CIRCUMFERENCE * 0.34;
const uid = $props.id();
const gradientId = `run-activity-comet-${uid}`;

const reduced = $derived(prefersReducedMotion.current);
const spinning = $derived(
  !reduced &&
    view.spinnerRate > 0 &&
    (view.kind === "active" ||
      view.kind === "quiet" ||
      view.kind === "waiting"),
);
const countdownOffset = $derived(
  CIRCUMFERENCE * (1 - (view.countdownFraction ?? 0)),
);

const elapsedOpacity = $derived(
  !view.elapsedLabel
    ? "opacity-0"
    : view.kind === "quiet"
      ? "opacity-50"
      : "opacity-75",
);

let labelWidth = $state(0);

/** Rotates the comet with the Web Animations API so playback-rate changes
 * (long waits slow down) never jump the rotation angle. */
function spin(node: SVGGElement, options: { running: boolean; rate: number }) {
  const animation = node.animate(
    [{ transform: "rotate(0turn)" }, { transform: "rotate(1turn)" }],
    { duration: 1300, iterations: Infinity },
  );
  function apply({ running, rate }: { running: boolean; rate: number }) {
    if (!running) {
      animation.pause();
      return;
    }
    if (animation.playbackRate !== rate) animation.updatePlaybackRate(rate);
    if (animation.playState !== "running") animation.play();
  }
  apply(options);
  return {
    update: apply,
    destroy: () => animation.cancel(),
  };
}

/** Tracks the incoming label's intrinsic width so the stack animates width
 * instead of jumping when labels of different length swap. */
function measureLabel(node: HTMLElement) {
  labelWidth = node.scrollWidth;
  const observer = new ResizeObserver(() => {
    labelWidth = node.scrollWidth;
  });
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}

/** Rolling crossfade: the new label rises in, the old one rises out. */
function roll(_node: Element, { direction }: { direction: 1 | -1 }) {
  if (reduced) {
    return { duration: 150, css: (t: number) => `opacity: ${t}` };
  }
  return {
    duration: direction === 1 ? 280 : 180,
    easing: cubicOut,
    css: (t: number, u: number) =>
      `opacity: ${t}; transform: translateY(${direction * u * 0.7}em); filter: blur(${u * 2}px)`,
  };
}
</script>

<div
  class={[
    "grid transition-[grid-template-rows] duration-300 ease-out",
    view.open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
  ]}
>
  <div class="min-h-0 overflow-hidden">
    <div
      class={[
        "group flex h-9 items-center px-3 gap-2 text-sm text-muted-foreground transition-[opacity,translate] duration-300 ease-out",
        !view.open && "translate-y-1 opacity-0",
      ]}
      data-kind={view.kind}
    >
      <span
        class="relative size-3.5 flex-none transition-[opacity,scale] duration-300 ease-out group-data-[kind=quiet]:scale-80 group-data-[kind=quiet]:opacity-50 group-data-[kind=waiting]:scale-80 group-data-[kind=waiting]:opacity-50"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          class="absolute inset-0 size-full text-primary"
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="8"
              y1="1"
              x2="14"
              y2="12"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stop-color="currentColor" stop-opacity="0" />
              <stop offset="1" stop-color="currentColor" />
            </linearGradient>
          </defs>
          <g
            class="transition-opacity duration-200 group-data-[kind=done]:opacity-0 group-data-[kind=retry]:opacity-0 group-data-[kind=stopped]:opacity-0"
          >
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              stroke-width="1.5"
              class="stroke-primary/20"
            />
            <g
              class="origin-center [transform-box:fill-box]"
              use:spin={{ running: spinning, rate: view.spinnerRate }}
            >
              <circle
                cx="8"
                cy="8"
                r={RING_RADIUS}
                stroke={`url(#${gradientId})`}
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-dasharray={`${COMET_ARC} ${CIRCUMFERENCE}`}
                transform="rotate(-90 8 8)"
              />
            </g>
          </g>
          <g
            class="opacity-0 transition-opacity duration-200 group-data-[kind=retry]:opacity-100"
          >
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              stroke-width="2"
              class="stroke-warning/20"
            />
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              stroke-width="2"
              class="stroke-warning transition-[stroke-dashoffset] duration-300 ease-linear"
              stroke-dasharray={CIRCUMFERENCE}
              stroke-dashoffset={countdownOffset}
              transform="rotate(-90 8 8)"
            />
          </g>
        </svg>
        <Check
          class="absolute inset-0 size-full scale-50 -rotate-12 text-success opacity-0 transition-[opacity,scale,rotate] duration-300 ease-out group-data-[kind=done]:scale-100 group-data-[kind=done]:rotate-0 group-data-[kind=done]:opacity-100"
          strokeWidth={2.5}
        />
        <Square
          class="absolute inset-0 size-full scale-50 fill-current p-0.5 opacity-0 transition-[opacity,scale] duration-300 ease-out group-data-[kind=stopped]:scale-100 group-data-[kind=stopped]:opacity-100"
        />
      </span>

      <span
        class="inline-grid h-5 items-center overflow-hidden whitespace-nowrap transition-[width] duration-300 ease-out"
        style:width={view.label ? `${labelWidth}px` : "0px"}
      >
        {#key view.labelKey}
          {#if view.label}
            <span
              class="col-start-1 row-start-1 w-max justify-self-start"
              class:shimmer={view.kind === "active" && !reduced}
              class:text-warning={view.tone === "warning"}
              use:measureLabel
              in:roll={{ direction: 1 }}
              out:roll={{ direction: -1 }}>{view.label}</span
            >
          {/if}
        {/key}
      </span>

      {#if view.kind === "waiting"}
        <span class="flex min-w-0 items-center gap-1 overflow-hidden">
          {#each chips as item (item.kind + item.id)}
            <button
              type="button"
              class="inline-flex h-5 max-w-48 flex-none cursor-pointer items-center gap-1 rounded-md border border-border bg-muted px-1.5 text-xs text-foreground transition-colors hover:bg-accent"
              title={item.kind === "agent"
                ? `Open ${item.label}`
                : `Background command: ${item.label}`}
              onclick={() => onOpenPending?.(item)}
            >
              {#if item.kind === "agent"}
                <StatusDot tone="info" size="xs" pulse />
                <span class="truncate">{item.label}</span>
              {:else}
                <Terminal class="size-3 flex-none text-muted-foreground" />
                <span class="truncate font-mono">{item.label}</span>
              {/if}
            </button>
          {/each}
          {#if overflow > 0}
            <button
              type="button"
              class="inline-flex h-5 flex-none cursor-pointer items-center rounded-md border border-border bg-muted px-1.5 text-xs text-muted-foreground hover:bg-accent"
              onclick={() => {
                const hidden = view.pending?.[MAX_CHIPS];
                if (hidden) onOpenPending?.(hidden);
              }}>+{overflow}</button
            >
          {/if}
        </span>
      {/if}

      <span
        class={[
          "text-xs tabular-nums transition-opacity duration-300",
          elapsedOpacity,
        ]}>{view.elapsedLabel ?? ""}</span
      >

      {#if view.retryEligible && onRetryResponse}
        <IconAction
          icon={RotateCw}
          label="Retry response"
          busy={retrying}
          onclick={() => {
            if (!retrying) onRetryResponse();
          }}
        />
      {/if}
    </div>
  </div>
</div>

<style>
.shimmer {
  background-image: linear-gradient(
    90deg,
    var(--muted-foreground) 0 38%,
    var(--foreground) 50%,
    var(--muted-foreground) 62% 100%
  );
  background-size: 300% 100%;
  background-clip: text;
  color: transparent;
  animation: activity-shimmer 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
