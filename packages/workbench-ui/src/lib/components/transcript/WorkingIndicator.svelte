<script lang="ts">
/** Compact one-line working state shown while the agent has not produced any
 * live timeline output yet: an orbiting dot, a shimmering label, and an
 * elapsed timer that only appears once the wait is long enough to matter. */

const TIMER_APPEAR_SECONDS = 3;

/** Generic working phrases only: this row shows before any real runtime
 * events exist, so labels must never claim specific activity. */
const PHRASES = [
  "Thinking…",
  "Planning next steps…",
  "Connecting the dots…",
  "Reasoning through it…",
  "Mapping it out…",
  "Gathering context…",
  "Weighing options…",
  "Putting the pieces together…",
  "Sketching an approach…",
  "Getting my bearings…",
];

// One phrase per wait: chosen at mount, stable until the row is replaced by
// real output.
const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];

let elapsedSeconds = $state(0);

$effect(() => {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  }, 250);
  return () => clearInterval(interval);
});

const elapsedLabel = $derived(
  `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`,
);
</script>

<div class="working-indicator">
  <span class="orbit" aria-hidden="true">
    <span class="orbit-spinner"></span>
  </span>
  <span class="label">{phrase}</span>
  {#if elapsedSeconds >= TIMER_APPEAR_SECONDS}
    <span class="elapsed">{elapsedLabel}</span>
  {/if}
</div>

<style>
.working-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
}

.orbit {
  position: relative;
  flex: none;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 9999px;
  border: 1px solid color-mix(in oklab, var(--primary) 35%, transparent);
}

.orbit-spinner {
  position: absolute;
  inset: -1px;
  animation: spin 1.4s linear infinite;
}

.orbit-spinner::before {
  content: "";
  position: absolute;
  top: -1.5px;
  left: 50%;
  width: 0.26rem;
  height: 0.26rem;
  margin-left: -0.13rem;
  border-radius: 9999px;
  background: var(--primary);
}

.label {
  background: linear-gradient(
    90deg,
    var(--muted-foreground) 35%,
    var(--foreground) 50%,
    var(--muted-foreground) 65%
  );
  background-size: 200% 100%;
  background-clip: text;
  color: transparent;
  /* background-position cannot be composited, so bound its per-frame repaint to
   * the label box instead of promoting a useless layer. */
  contain: paint;
  animation: text-shimmer 2.2s linear infinite;
}

.elapsed {
  color: var(--muted-foreground);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  animation: transcript-live-enter var(--motion-enter-duration)
    var(--motion-enter-easing) both;
}

/* The global reduced-motion rule freezes animations; also drop the gradient so
 * the label reads as plain text instead of a frozen sheen. */
@media (prefers-reduced-motion: reduce) {
  .label {
    background: none;
    color: var(--muted-foreground);
  }
}
</style>
