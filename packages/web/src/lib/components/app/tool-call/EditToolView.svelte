<script lang="ts">
  import type { ToolCallRecord } from "../../../api";
  import type { ToolView } from "../../../tool-views/tool-result-view";
  import DiffBlock from "./DiffBlock.svelte";

  type Props = { toolCall: ToolCallRecord; view: Extract<ToolView, { kind: "edit" }> };
  let { view }: Props = $props();
</script>

{#if view.diff}
  <DiffBlock diff={view.diff} />
{/if}
