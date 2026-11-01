<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import type { GitPanelModel } from "./git-panel-types";

let { model }: { model: GitPanelModel } = $props();
</script>

{#if !model.availability.available}
  <Callout layout="strip" tone="neutral">{model.availability.message}</Callout>
{:else if model.initialLoading}
  <Callout layout="strip" tone="neutral">Loading Git repositories…</Callout>
{:else if model.repositories.length === 0}
  <Callout layout="strip" tone="neutral">
    {model.emptyMessage ?? "No Git repositories found."}
  </Callout>
{/if}
