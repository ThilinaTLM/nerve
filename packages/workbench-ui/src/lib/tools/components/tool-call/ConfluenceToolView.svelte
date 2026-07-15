<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { confluenceToolSummaryBody } from "../../views/atlassian-tool-summary";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type ConfluenceView = Extract<ToolView, { kind: "confluence" }>;

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: ConfluenceView;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const summary = $derived(
  confluenceToolSummaryBody(toolCall, view, { expanded }),
);
</script>

{#if summary}
  <ToolArgumentBody body={{ kind: "atlassian-summary", text: summary }} />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">
    No Confluence summary available. Open Details for raw arguments and result.
  </p>
{/if}
