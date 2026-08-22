<script lang="ts">
import { desktopRuntime, desktopShutdownState } from "$lib/platform/desktop";

const desktopQuitting = $derived(
  desktopRuntime.quitting || desktopShutdownState.quitRequested,
);
</script>

{#if desktopRuntime.isDesktop && desktopQuitting}
  <div class="shutdown-overlay" role="status" aria-live="polite">
    <div class="shutdown-card">
      <div class="shutdown-spinner" aria-hidden="true"></div>
      <strong>Closing Nerve…</strong>
      <span>Stopping the local daemon safely.</span>
    </div>
  </div>
{/if}

<style>
.shutdown-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: color-mix(in oklab, var(--background) 72%, transparent);
  backdrop-filter: blur(10px);
}

.shutdown-card {
  display: grid;
  justify-items: center;
  gap: 0.45rem;
  min-width: 16rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card);
  padding: 1.25rem 1.5rem;
  color: var(--foreground);
  box-shadow: var(--shadow-md);
}

.shutdown-card span {
  color: var(--muted-foreground);
  font-size: var(--text-sm);
}

/* Binds the shared spin keyframe at the shutdown cadence
 * (escape-hatch reason 1). */
.shutdown-spinner {
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid var(--muted);
  border-top-color: var(--primary);
  border-radius: 999px;
  animation: spin 800ms linear infinite;
}
</style>
