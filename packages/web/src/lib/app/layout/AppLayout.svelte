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
</style>
