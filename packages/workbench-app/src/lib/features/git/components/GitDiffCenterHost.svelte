<script lang="ts">
import { diffViewKey } from "$lib/kernel/navigation/view-keys";
import { GitDiffPane } from "$lib/features/git/ui";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { refreshDiffPane } from "$lib/features/git/state/diff-tabs.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

const activeView = $derived.by(() => {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "diff") return undefined;
  return gitState.diffViews[diffViewKey(active.id)];
});
</script>

<GitDiffPane
  view={activeView}
  onRefresh={() => activeView && void refreshDiffPane(activeView.id)}
/>
