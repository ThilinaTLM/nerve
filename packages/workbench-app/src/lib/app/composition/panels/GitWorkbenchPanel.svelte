<script lang="ts">
import {
  GitPanel,
  type GitPanelActions,
  type GitPanelModel,
} from "$lib/features/git";

let {
  gitModel,
  gitActions,
}: { gitModel: GitPanelModel; gitActions: GitPanelActions } = $props();
</script>

<GitPanel model={gitModel} actions={gitActions} />
