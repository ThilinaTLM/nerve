<script lang="ts">
import { FilePane } from "$lib/presentation/components/file";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const activeCenterFileView = $derived(fileSelectors.activeCenterFileView);
</script>

<FilePane view={activeCenterFileView} />
