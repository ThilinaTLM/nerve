<script lang="ts">
import { diffViewKey } from "$lib/core/state/state-keys";
import { GitDiffPane } from "$lib/presentation/git";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { refreshDiffPane } from "$lib/features/git/state/diff-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

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
