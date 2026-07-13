<script lang="ts">
import type { AgentRecord, ProjectRecord } from "$lib/api";
import { createWorkbenchGitPanelAdapter } from "$lib/features/git/state/workbench-git-panel-adapter.svelte";
import { GitUtilityPanelView } from "@nervekit/workbench-ui";

type Props = {
  activeProject?: ProjectRecord;
  activeAgent?: AgentRecord;
};

let { activeProject }: Props = $props();
const adapter = createWorkbenchGitPanelAdapter(() => activeProject);
</script>

<GitUtilityPanelView model={adapter.model} actions={adapter.actions} />
