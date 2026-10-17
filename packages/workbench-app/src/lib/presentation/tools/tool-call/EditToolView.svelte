<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import type { ToolView } from "../views/tool-result-view";
import { toolLifecycleSpec } from "../lifecycle/registry";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "edit" }>;
  expanded?: boolean;
  onOpenFile?: (path: string) => void;
};
let { toolCall, view, expanded = false }: Props = $props();

// In the card the persistent argument body already shows every operation's
// diff (and marks failed ones), so the result adds nothing. The expanded
// formatted view has no argument body and still shows the applied diff.
const argumentsShowDiff = $derived(
  !expanded && toolLifecycleSpec("edit").argumentRegion === "persistent",
);
const unchanged = $derived(
  toolCall.status === "completed" &&
    !view.diff &&
    (view.operations?.length ?? view.operationCount) === 0,
);
</script>

{#if argumentsShowDiff ? unchanged : view.diff || toolCall.status === "completed"}
  <ToolSections>
    {#if !argumentsShowDiff && view.diff}
      <div class="px-2.5 py-2">
        <ToolOutputBlock
          text={view.diff}
          language="diff"
          direction="tail"
          {expanded}
        />
      </div>
    {:else}
      <div class="px-2.5 py-2 text-xs text-muted-foreground">No changes.</div>
    {/if}
  </ToolSections>
{/if}
