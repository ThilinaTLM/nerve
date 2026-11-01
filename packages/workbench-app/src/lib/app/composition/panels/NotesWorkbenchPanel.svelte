<script lang="ts">
import { NotesPanelHost } from "$lib/features/scratch-notes";
import { workspaceSelectors } from "$lib/application/workspace";

const activeProject = $derived(workspaceSelectors.activeProject);
</script>

<NotesPanelHost {activeProject} />
