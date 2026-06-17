<script lang="ts">
  import BrowserNotificationPrompt from "$lib/features/notifications/BrowserNotificationPrompt.svelte";
  import DesktopShutdownOverlay from "$lib/app/layout/DesktopShutdownOverlay.svelte";
  import FooterbarContainer from "$lib/app/layout/FooterbarContainer.svelte";
  import ProjectDialogs from "$lib/app/layout/ProjectDialogs.svelte";
  import ShellPanes from "$lib/app/layout/ShellPanes.svelte";
  import TitlebarContainer from "$lib/app/layout/TitlebarContainer.svelte";
</script>

<main class="app-frame">
  <TitlebarContainer />
  <ShellPanes />
  <FooterbarContainer />
  <BrowserNotificationPrompt />
  <DesktopShutdownOverlay />
</main>

<ProjectDialogs />

<style>
  .app-frame {
    display: grid;
    width: 100vw;
    height: 100vh;
    min-width: 0;
    min-height: 0;
    grid-template-rows: 3rem minmax(0, 1fr) 1.75rem;
    position: relative;
    overflow: hidden;
    background: var(--background);
    color: var(--foreground);
  }

  :global(.workspace-shell) {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--sidebar);
  }

  :global(.workspace-shell [data-pane-group]) {
    width: 100%;
    height: 100%;
  }

  :global(.pane-shell) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--sidebar);
  }

  :global(.center-shell) {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--background);
  }

  :global(.utility-shell) {
    background: var(--sidebar);
  }

  :global(.shutdown-overlay) {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: color-mix(in oklab, var(--background) 72%, transparent);
    backdrop-filter: blur(10px);
  }

  :global(.shutdown-card) {
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

  :global(.shutdown-card span) {
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  :global(.shutdown-spinner) {
    width: 1.75rem;
    height: 1.75rem;
    border: 2px solid var(--muted);
    border-top-color: var(--primary);
    border-radius: 999px;
    animation: shutdown-spin 800ms linear infinite;
  }

  @keyframes shutdown-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 980px) {
    /* Desktop/workbench-first shell: preserve pane usability instead of collapsing to mobile drawers. */
    :global(.workspace-shell) {
      overflow: auto;
    }

    :global(.workspace-shell [data-pane-group]) {
      min-width: 980px;
    }
  }
</style>
