<script lang="ts">
  import { desktopRuntime } from "$lib/features/desktop/state/desktop-bridge.svelte";
  import { workbenchUiState } from "$lib/app/state/workbench-ui-state.svelte";

  const desktopQuitting = $derived(
    desktopRuntime.quitting || workbenchUiState.desktopQuitRequested,
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
