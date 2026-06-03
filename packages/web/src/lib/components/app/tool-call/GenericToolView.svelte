<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";

  // The shell renders generic arguments/result/raw-result disclosures for this kind.
  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "generic" }> };
  let {}: Props = $props();
</script>
