<script lang="ts">
import { desktopRuntime, desktopShutdownState } from "$lib/features/desktop";

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
