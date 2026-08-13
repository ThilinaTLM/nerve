<script lang="ts">
import { FilePane } from "$lib/presentation/components/file";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const activeCenterFileView = $derived(fileSelectors.activeCenterFileView);

function openLinkedFile(path: string, line?: number): void {
  if (!activeCenterFileView) return;
  void openFilePane({
    projectId: activeCenterFileView.projectId,
    path,
    line,
  });
}
</script>

<FilePane view={activeCenterFileView} onOpenFile={openLinkedFile} />
