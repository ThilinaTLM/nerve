<script lang="ts">
import type { AgentRecord, ProjectRecord } from "$lib/api";
import GitPanelViewContent from "./GitPanelViewContent.svelte";

type Props = {
  activeProject?: ProjectRecord;
  activeAgent?: AgentRecord;
};

let props: Props = $props();
</script>

<GitPanelViewContent {...props} />
