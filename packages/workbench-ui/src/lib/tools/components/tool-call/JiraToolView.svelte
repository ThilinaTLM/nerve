<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { jiraToolSummaryBody } from "../../views/atlassian-tool-summary";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type JiraView = Extract<ToolView, { kind: "jira" }>;

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: JiraView;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const summary = $derived(jiraToolSummaryBody(toolCall, view, { expanded }));
</script>

{#if summary}
  <ToolArgumentBody body={{ kind: "atlassian-summary", text: summary }} />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">
    No Jira summary available. Open Details for raw arguments and result.
  </p>
{/if}
