<script lang="ts">
import { NotesPanel } from "$lib/features/scratch-notes";
import { workspaceSelectors } from "$lib/application/workspace";

const activeProject = $derived(workspaceSelectors.activeProject);
</script>

<NotesPanel {activeProject} />
