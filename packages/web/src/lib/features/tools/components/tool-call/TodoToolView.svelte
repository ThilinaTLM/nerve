<script lang="ts">
  import type { ToolCallDisplayRecord } from "$lib/features/tools/views/tool-result-view";
  import type { ToolView } from "$lib/features/tools/views/tool-result-view";
  import TodoChecklist from "./TodoChecklist.svelte";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: Extract<ToolView, { kind: "todos" }>;
  };
  let { view }: Props = $props();
</script>

<TodoChecklist items={view.items} />
