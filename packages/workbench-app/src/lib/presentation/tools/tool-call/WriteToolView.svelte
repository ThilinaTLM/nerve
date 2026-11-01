<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import { extname } from "../views/lang";
import type { ToolView } from "../views/tool-result-view";
import { toolLifecycleSpec } from "../lifecycle/registry";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "write" }>;
  expanded?: boolean;
  onOpenFile?: (path: string) => void;
};
let { toolCall, view, expanded = false }: Props = $props();

const language = $derived(extname(view.relPath));
const hasContent = $derived(
  view.content !== undefined && view.content.length > 0,
);
// In the card the persistent argument body already holds the written content,
// so the result only adds the empty-file note. The expanded formatted view has
// no argument body and shows the content itself.
const argumentsShowContent = $derived(
  !expanded && toolLifecycleSpec("write").argumentRegion === "persistent",
);
const empty = $derived(toolCall.status === "completed" && !hasContent);
</script>

{#if argumentsShowContent ? empty : hasContent || empty}
  <ToolSections>
    {#if !argumentsShowContent && hasContent}
      <div class="px-2.5 py-2">
        <ToolOutputBlock
          text={view.content ?? ""}
          {language}
          direction="tail"
          {expanded}
        />
      </div>
    {:else}
      <div class="px-2.5 py-2 text-ui text-muted-foreground">
        Empty file written.
      </div>
    {/if}
  </ToolSections>
{/if}
