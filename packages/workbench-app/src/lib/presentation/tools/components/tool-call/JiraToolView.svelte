<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import FlaskConical from "@lucide/svelte/icons/flask-conical";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { getConversationUiCapabilities } from "../../../context.svelte";
import { jiraToolSummaryBody } from "../../views/atlassian-tool-summary";
import {
  hasStructuredJira,
  jiraBanner,
  jiraEmptyMessage,
} from "../../views/atlassian-view-body";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { ATLASSIAN_COLLAPSED_ITEMS } from "../../views/tool-result-view";
import AtlassianBanner from "./AtlassianBanner.svelte";
import JiraFieldRow from "./JiraFieldRow.svelte";
import JiraIssueCard from "./JiraIssueCard.svelte";
import JiraMetricStrip from "./JiraMetricStrip.svelte";
import JiraProjectHeader from "./JiraProjectHeader.svelte";
import JiraTransitionRow from "./JiraTransitionRow.svelte";
import JiraUserCard from "./JiraUserCard.svelte";
import ToolArgumentBody from "./ToolArgumentBody.svelte";

type JiraView = Extract<ToolView, { kind: "jira" }>;

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: JiraView;
  expanded?: boolean;
};
let { toolCall, view, expanded = false }: Props = $props();

const capabilities = getConversationUiCapabilities();
const siteUrl = $derived(capabilities.atlassian?.jiraSiteUrl());
const limit = $derived(
  expanded ? Number.POSITIVE_INFINITY : ATLASSIAN_COLLAPSED_ITEMS,
);
const banner = $derived(jiraBanner(view, toolCall.status));
const emptyMessage = $derived(jiraEmptyMessage(view, toolCall.status));
const structured = $derived(hasStructuredJira(view, toolCall.status));
const fallbackSummary = $derived(
  structured ? undefined : jiraToolSummaryBody(toolCall, view, { expanded }),
);
const updatedFieldKeys = $derived(view.updatedFields ?? []);
const hiddenFieldKeyCount = $derived(
  Math.max(0, updatedFieldKeys.length - limit),
);
</script>

{#snippet caption(text: string)}
  <span class="text-xs font-medium text-muted-foreground">{text}</span>
{/snippet}

{#if structured}
  <div class="grid gap-1.5">
    {#if banner}
      <AtlassianBanner
        text={banner.text}
        tone={banner.tone}
        icon={banner.tone === "info" ? FlaskConical : CircleCheck}
      />
    {/if}

    {#if view.action === "search_issues"}
      {#each view.issues.slice(0, limit) as issue (issue.key)}
        <JiraIssueCard {issue} {siteUrl} />
      {/each}
    {:else if view.action === "search_users"}
      {#each view.users.slice(0, limit) as user (user.accountId)}
        <JiraUserCard {user} />
      {/each}
    {:else if view.action === "get_issue"}
      {#if view.issue}
        <JiraIssueCard issue={view.issue} {siteUrl} />
      {/if}
      {#if view.includedCounts}
        <JiraMetricStrip counts={view.includedCounts} />
      {/if}
      {#if view.transitions.length > 0}
        {@render caption("Transitions")}
        {#each view.transitions.slice(0, limit) as transition (transition.id)}
          <JiraTransitionRow {transition} />
        {/each}
      {/if}
    {:else if view.action === "get_project"}
      {#if view.project}
        <JiraProjectHeader project={view.project} />
      {/if}
      {#if view.includedCounts}
        <JiraMetricStrip counts={view.includedCounts} />
      {/if}
      {#if view.fields.length > 0}
        {@render caption("Fields")}
        {#each view.fields.slice(0, limit) as field (field.id)}
          <JiraFieldRow {field} />
        {/each}
      {/if}
    {:else if view.action === "create_issue"}
      {#if view.issue}
        <JiraIssueCard issue={view.issue} {siteUrl} />
      {/if}
      {#if view.resolvedAssignee}
        {@render caption("Assignee")}
        <JiraUserCard user={view.resolvedAssignee} />
      {/if}
    {:else if view.action === "update_issue"}
      {#if updatedFieldKeys.length > 0}
        <div class="flex flex-wrap items-center gap-1">
          {#each updatedFieldKeys.slice(0, limit) as key (key)}
            <Badge tone="neutral" size="xs" class="font-mono">{key}</Badge>
          {/each}
          {#if hiddenFieldKeyCount > 0}
            <span class="text-xs text-muted-foreground"
              >+{hiddenFieldKeyCount} more</span
            >
          {/if}
        </div>
      {/if}
      {#if view.issue}
        <JiraIssueCard issue={view.issue} {siteUrl} />
      {/if}
      {#if view.resolvedAssignee}
        {@render caption("Assignee")}
        <JiraUserCard user={view.resolvedAssignee} />
      {/if}
    {:else if view.action === "transition_issue"}
      {#if view.transition}
        <JiraTransitionRow transition={view.transition} />
      {:else if view.transitions.length > 0}
        {@render caption("Available transitions")}
        {#each view.transitions.slice(0, limit) as transition (transition.id)}
          <JiraTransitionRow {transition} />
        {/each}
      {/if}
      {#if view.fields.length > 0}
        {@render caption("Transition fields")}
        {#each view.fields.slice(0, limit) as field (field.id)}
          <JiraFieldRow {field} />
        {/each}
      {/if}
    {/if}

    {#if emptyMessage}
      <p class="m-0 text-xs text-muted-foreground">{emptyMessage}</p>
    {/if}
  </div>
{:else if fallbackSummary}
  <ToolArgumentBody
    body={{ kind: "atlassian-summary", text: fallbackSummary }}
  />
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">
    No Jira summary available. Open Details for raw arguments and result.
  </p>
{/if}
