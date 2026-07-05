<script lang="ts">
  import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
  import type { ToolView } from "../../views/tool-result-view";

  type Props = { toolCall: ToolCallDisplayRecord; view: Extract<ToolView, { kind: "generic" }> };
  let {}: Props = $props();
</script>
