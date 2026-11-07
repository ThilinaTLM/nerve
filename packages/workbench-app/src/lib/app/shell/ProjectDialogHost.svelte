<script lang="ts">
import ProjectDirectoryPicker from "$lib/app/composition/dialogs/ProjectDirectoryPicker.svelte";
import { isLocalDesktopDaemon, isDesktopApp } from "$lib/platform/desktop";
import {
  openProjectDirectory,
  selectProject,
  workspaceSelectors,
  workspaceState,
} from "$lib/application/workspace";

const projects = $derived(workspaceSelectors.projects);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// The folders listed are the daemon's. The daemon reports no host name, so
// name it only when that is certain: the desktop shell's own daemon, or the
// host the web UI was served from.
let hostLabel = $state<string | undefined>();
$effect(() => {
  if (!workspaceState.projectPickerOpen) return;
  let current = true;
  const fromBrowser =
    typeof location === "undefined"
      ? undefined
      : LOOPBACK_HOSTS.has(location.hostname)
        ? "this computer"
        : location.hostname;
  if (!isDesktopApp()) {
    hostLabel = fromBrowser;
    return;
  }
  void isLocalDesktopDaemon().then((local) => {
    if (current) hostLabel = local ? "this computer" : undefined;
  });
  return () => {
    current = false;
  };
});
</script>

<ProjectDirectoryPicker
  bind:open={workspaceState.projectPickerOpen}
  {projects}
  initialPath={workspaceState.projectPickerPath}
  {hostLabel}
  onSelectProject={(projectId) => void selectProject(projectId)}
  onOpenDirectory={(path) => void openProjectDirectory(path)}
/>
