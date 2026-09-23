<script lang="ts">
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import TeammateRow from "./TeammateRow.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "subagent" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, onOpenFile }: Props = $props();
</script>

{#if view.previewUnavailable}
  <p class="m-0 text-xs text-warning">
    Teammate preview unavailable. Open details to inspect the full result.
  </p>
{:else if view.action === "list" && view.teammates.length === 0 && toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No teammates yet.</p>
{:else if toolCall.status === "completed"}
  <div class="grid gap-1.5">
    {#each view.teammates as teammate, index (teammate.agentId ?? `${teammate.name}:${index}`)}
      <TeammateRow {teammate} parentAgentId={toolCall.agentId} />
    {/each}
    {#if view.response}
      <div
        class="min-w-0 rounded-sm border bg-well px-3 py-2 text-sm"
        aria-label={`Response from ${view.teammates[0]?.name ?? "teammate"}`}
      >
        <Markdown text={view.response.text} {onOpenFile} />
      </div>
    {:else if view.action === "status" && view.teammates[0]?.state === "idle"}
      <p class="m-0 text-xs text-muted-foreground">No response yet.</p>
    {/if}
  </div>
{/if}
