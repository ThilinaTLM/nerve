<script lang="ts">
import { MermaidPane } from "$lib/presentation/components/mermaid";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const view = $derived(fileSelectors.activeCenterMermaidView);
const filePath = $derived(view?.relativePath ?? view?.path ?? "Markdown file");
</script>

<MermaidPane
  source={view?.source}
  loading={view?.loading}
  error={view?.error}
  truncated={view?.truncated}
  ariaLabel={`Mermaid diagram from ${filePath}`}
/>
