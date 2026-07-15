<script lang="ts">
import { FilePane } from "@nervekit/workbench-ui/components/file";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const activeCenterFileView = $derived(fileSelectors.activeCenterFileView);
</script>

<FilePane view={activeCenterFileView} />
