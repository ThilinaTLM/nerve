<script lang="ts">
import { MermaidPane } from "$lib/presentation/mermaid";
import { fileSelectors } from "$lib/features/filesystem/state/file-selectors.svelte";

const view = $derived(fileSelectors.activeCenterMermaidView);
const sourceLabel = $derived(
  view?.origin === "file"
    ? (view.relativePath ?? view.path)
    : (view?.name ?? "assistant message"),
);
</script>

<MermaidPane
  source={view?.source}
  loading={view?.loading}
  error={view?.error}
  truncated={view?.origin === "file" ? view.truncated : false}
  ariaLabel={`Mermaid diagram from ${sourceLabel}`}
/>
