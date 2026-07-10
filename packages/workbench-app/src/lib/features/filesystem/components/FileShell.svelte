<script lang="ts">
import FilePane from "$lib/features/filesystem/components/FilePane.svelte";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const activeCenterFileView = $derived(fileSelectors.activeCenterFileView);
</script>

<FilePane view={activeCenterFileView} />
