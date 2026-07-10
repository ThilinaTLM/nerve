<script lang="ts">
import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
import type { ToolView } from "../../views/tool-result-view";
import TodoChecklist from "./TodoChecklist.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "todos" }>;
};
let { view }: Props = $props();
</script>

<TodoChecklist items={view.items} />
