<script lang="ts">
  import type { AgentRecord, ProjectRecord } from "$lib/api";
  import GitUtilityPanelContent from "./GitUtilityPanelContent.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeAgent?: AgentRecord;
  };

  let props: Props = $props();
</script>

<GitUtilityPanelContent {...props} />
