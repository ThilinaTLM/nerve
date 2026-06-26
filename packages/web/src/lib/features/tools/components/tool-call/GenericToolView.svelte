<script lang="ts">
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";

  type Props = { toolCall: ToolCallDisplayRecord; view: Extract<ToolView, { kind: "generic" }> };
  let {}: Props = $props();
</script>
