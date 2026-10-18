<script lang="ts">
import { PanelBanner } from "$lib/presentation/panels";
import type { GitPanelModel } from "./git-panel-types";

let { model }: { model: GitPanelModel } = $props();
</script>

{#if !model.availability.available}
  <PanelBanner tone="neutral">{model.availability.message}</PanelBanner>
{:else if model.initialLoading}
  <PanelBanner tone="neutral">Loading Git repositories…</PanelBanner>
{:else if model.repositories.length === 0}
  <PanelBanner tone="neutral">
    {model.emptyMessage ?? "No Git repositories found."}
  </PanelBanner>
{/if}
