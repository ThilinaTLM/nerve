<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import TodoChecklist from "./TodoChecklist.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "todos" }>;
};
let { toolCall, view }: Props = $props();
</script>

{#if view.items.length > 0}
  <TodoChecklist items={view.items} />
{:else if toolCall.status === "completed"}
  <TodoChecklist items={[]} emptyLabel="No todos." />
{/if}
