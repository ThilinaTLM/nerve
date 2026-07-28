<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { PanelBanner } from "$lib/presentation/panel";
import type { GitPanelModel } from "./git-panel-types";

let { model }: { model: GitPanelModel } = $props();
</script>

{#if !model.availability.available}
  <PanelBanner tone="muted">{model.availability.message}</PanelBanner>
{:else if model.cachedError && model.repositories.length === 0}
  <PanelBanner tone="destructive" icon={TriangleAlert}>
    {model.cachedError}
  </PanelBanner>
{:else if model.cachedError}
  <PanelBanner tone="warning" icon={TriangleAlert}>
    Using cached Git data. Refresh failed: {model.cachedError}
  </PanelBanner>
{:else if model.initialLoading}
  <PanelBanner tone="muted">Loading Git repositories…</PanelBanner>
{:else if model.repositories.length === 0}
  <PanelBanner tone="muted">
    {model.emptyMessage ?? "No Git repositories found."}
  </PanelBanner>
{/if}
