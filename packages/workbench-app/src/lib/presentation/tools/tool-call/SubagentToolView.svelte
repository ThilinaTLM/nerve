<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { subagentOutput } from "../views/subagent-output";
import ToolOutputBlock from "./ToolOutputBlock.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "subagent" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false }: Props = $props();
const output = $derived(subagentOutput(view));
</script>

{#if view.previewUnavailable}
  <p class="m-0 text-xs text-warning">
    Teammate preview unavailable. Open details to inspect the full result.
  </p>
{:else if view.action === "list" && view.teammates.length === 0 && toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No teammates yet.</p>
{:else if toolCall.status === "completed" && output}
  <section aria-label="Teammate result">
    <ToolOutputBlock text={output} {expanded} />
  </section>
{/if}
