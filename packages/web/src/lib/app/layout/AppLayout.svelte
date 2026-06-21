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
    width: 100%;
    height: 100vh;
    /* Dynamic viewport height keeps the composer above the mobile keyboard. */
    height: 100dvh;
    min-width: 0;
    min-height: 0;
    grid-template-rows: 3rem minmax(0, 1fr) 1.75rem;
    position: relative;
    overflow: hidden;
    background: var(--background);
    color: var(--foreground);
  }

  /* Phone: give the footer a touch-sized row (+ home-indicator safe area). */
  @media (max-width: 639px) {
    .app-frame {
      grid-template-rows:
        calc(3rem + env(safe-area-inset-top))
        minmax(0, 1fr)
        calc(2.5rem + env(safe-area-inset-bottom));
    }
  }
</style>
