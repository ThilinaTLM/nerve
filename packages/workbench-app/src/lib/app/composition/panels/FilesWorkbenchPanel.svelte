<script lang="ts">
import FilesPanelHost from "$lib/features/filesystem/hosts/FilesPanelHost.svelte";
import {
  openProjectInEditorAndNotify,
  openProjectInTerminalAndNotify,
  workspaceSelectors,
} from "$lib/application/workspace";

const status = $derived(workspaceSelectors.status);
const activeProject = $derived(workspaceSelectors.activeProject);
</script>

<FilesPanelHost
  {activeProject}
  editorAvailability={status?.runtime.editors}
  terminalAvailability={status?.runtime.terminal}
  onOpenInEditor={(projectId, editor, path) =>
    void openProjectInEditorAndNotify(projectId, editor, path)}
  onOpenInTerminal={(projectId, path) =>
    void openProjectInTerminalAndNotify(projectId, path)}
/>
