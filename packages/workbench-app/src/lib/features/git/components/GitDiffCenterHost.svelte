<script lang="ts">
import { diffViewKey } from "$lib/kernel/navigation/view-keys";
import { notifyCopyResult } from "@nervekit/ui-kit/core/notify";
import { GitDiffPane } from "$lib/features/git/ui";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import {
  refreshDiffPane,
  toggleDiffLineWrap,
} from "$lib/features/git/state/diff-tabs.svelte";
import {
  fileViewerPreferences,
  setHighlightSelectionMatches,
} from "$lib/application/workspace/file-viewer-preferences.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

const activeView = $derived.by(() => {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "diff") return undefined;
  return gitState.diffViews[diffViewKey(active.id)];
});
</script>

<GitDiffPane
  view={activeView}
  wrap={activeView?.wrapLines}
  highlightSelectionMatches={fileViewerPreferences.highlightSelectionMatches}
  onCopy={(ok) => notifyCopyResult(ok, "selection")}
  onRefresh={() => activeView && void refreshDiffPane(activeView.id)}
  onToggleSelectionMatches={() =>
    setHighlightSelectionMatches(
      !fileViewerPreferences.highlightSelectionMatches,
    )}
  onToggleWrap={() => activeView && toggleDiffLineWrap(activeView.id)}
/>
