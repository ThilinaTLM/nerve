<script lang="ts">
  import { WorkbenchFrame } from "@nervekit/shared-ui/components/workbench";
  import BrowserNotificationPrompt from "$lib/features/notifications/BrowserNotificationPrompt.svelte";
  import DesktopShutdownOverlay from "$lib/app/layout/DesktopShutdownOverlay.svelte";
  import FooterbarContainer from "$lib/app/layout/FooterbarContainer.svelte";
  import ProjectDialogs from "$lib/app/layout/ProjectDialogs.svelte";
  import ShellPanes from "$lib/app/layout/ShellPanes.svelte";
  import TitlebarContainer from "$lib/app/layout/TitlebarContainer.svelte";
</script>

<WorkbenchFrame>
  {#snippet titlebar()}
    <TitlebarContainer />
  {/snippet}
  {#snippet workspace()}
    <ShellPanes />
    <BrowserNotificationPrompt />
    <DesktopShutdownOverlay />
  {/snippet}
  {#snippet footer()}
    <FooterbarContainer />
  {/snippet}
</WorkbenchFrame>

<ProjectDialogs />
