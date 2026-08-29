<script lang="ts">
import PullRequestsPanel from "$lib/features/git/views/PullRequestsPanel.svelte";
import type { GitPanelActions, GitPanelModel } from "$lib/features/git";

let {
  gitModel,
  gitActions,
}: { gitModel: GitPanelModel; gitActions: GitPanelActions } = $props();
</script>

<PullRequestsPanel model={gitModel} actions={gitActions} />
