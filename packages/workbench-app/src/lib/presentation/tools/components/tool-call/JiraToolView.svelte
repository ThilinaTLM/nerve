<script lang="ts">
import { getConversationUiCapabilities } from "../../../context.svelte";
import { jiraToolSummaryBody } from "../../views/atlassian-tool-summary";
import { formatBytes } from "../../views/tool-presentation-helpers";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../../views/tool-result-view";
import { ATLASSIAN_COLLAPSED_ITEMS } from "../../views/tool-result-view";
import AtlassianOutcomeRow from "./AtlassianOutcomeRow.svelte";
import AtlassianResourceRow from "./AtlassianResourceRow.svelte";
import AtlassianResultSurface from "./AtlassianResultSurface.svelte";
import JiraFieldRow from "./JiraFieldRow.svelte";
import JiraIssueCard from "./JiraIssueCard.svelte";
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
const fallbackSummary = $derived(
  jiraToolSummaryBody(toolCall, view, { expanded }),
);

function joined(...values: Array<string | undefined>): string | undefined {
  const text = values.filter(Boolean).join(" · ");
  return text || undefined;
}
function operationLabel(operation: string | undefined): string {
  return (operation ?? "update").replaceAll("_", " ");
}
function past(operation: string | undefined): string {
  switch (operation) {
    case "create":
      return "Created";
    case "delete":
      return "Deleted";
    case "upload":
      return "Uploaded";
    case "start":
      return "Started";
    case "close":
      return "Closed";
    case "move_to_backlog":
    case "move_to_sprint":
      return "Moved";
    case "rank":
      return "Ranked";
    default:
      return "Updated";
  }
}
function outcomeTone(destructive = false) {
  if (view.dryRun) return "info" as const;
  return destructive ? ("destructive" as const) : ("success" as const);
}
function outcomeTitle(text: string): string {
  return view.dryRun ? `Would ${text[0]?.toLowerCase()}${text.slice(1)}` : text;
}
</script>

{#if toolCall.status === "completed"}
  <AtlassianResultSurface>
    {#if view.action === "search_issues"}
      {#each view.issues.slice(0, limit) as issue (issue.key)}
        <JiraIssueCard {issue} {siteUrl} />
      {:else}
        <AtlassianOutcomeRow title="No issues found." />
      {/each}
    {:else if view.action === "search_users"}
      {#each view.users.slice(0, limit) as user (user.accountId)}
        <JiraUserCard {user} />
      {:else}
        <AtlassianOutcomeRow title="No users found." />
      {/each}
    {:else if view.action === "get_issue"}
      {#if view.issue}
        <JiraIssueCard issue={view.issue} {siteUrl} />
      {:else}
        <AtlassianOutcomeRow
          title={view.issueKey ? `Fetched ${view.issueKey}` : "Issue fetched"}
          detail="Open Details for the complete response."
        />
      {/if}
      {#if expanded}
        {#each view.transitions as transition (transition.id)}
          <JiraTransitionRow {transition} />
        {/each}
      {/if}
    {:else if view.action === "get_project"}
      {#if view.project}
        <JiraProjectHeader project={view.project} />
      {:else}
        <AtlassianOutcomeRow
          title={view.projectKey
            ? `Fetched project ${view.projectKey}`
            : "Project fetched"}
        />
      {/if}
      {#if expanded}
        {#each view.fields as field (field.id)}
          <JiraFieldRow {field} />
        {/each}
      {/if}
    {:else if view.action === "search_boards"}
      {#each view.boards.slice(0, limit) as board (board.id)}
        <AtlassianResourceRow
          icon="board"
          id={board.id}
          title={board.name}
          detail={joined(board.type, board.projectKey, board.projectName)}
        />
      {:else}
        <AtlassianOutcomeRow title="No boards found." />
      {/each}
    {:else if view.action === "get_board"}
      {#if view.board}
        <AtlassianResourceRow
          icon="board"
          id={view.board.id}
          title={view.board.name}
          detail={joined(
            view.board.type,
            view.board.projectKey,
            view.board.projectName,
          )}
        />
      {:else}
        <AtlassianOutcomeRow
          title={view.boardId
            ? `Fetched board ${view.boardId}`
            : "Board fetched"}
          detail="Open Details for the complete response."
        />
      {/if}
      {#if expanded}
        {#each view.sprints as sprint (sprint.id)}
          <AtlassianResourceRow
            icon="sprint"
            id={sprint.id}
            title={sprint.name}
            status={sprint.state}
            detail={joined(sprint.goal, sprint.startDate, sprint.endDate)}
          />
        {/each}
        {#each view.backlogIssues as issue (issue.key)}
          <JiraIssueCard {issue} {siteUrl} />
        {/each}
      {/if}
    {:else if view.action === "get_sprint"}
      {#if view.sprint}
        <AtlassianResourceRow
          icon="sprint"
          id={view.sprint.id}
          title={view.sprint.name}
          status={view.sprint.state}
          detail={joined(
            view.sprint.goal,
            view.sprint.startDate,
            view.sprint.endDate,
          )}
        />
      {:else}
        <AtlassianOutcomeRow
          title={view.sprintId
            ? `Fetched sprint ${view.sprintId}`
            : "Sprint fetched"}
        />
      {/if}
      {#if expanded}
        {#each view.issues as issue (issue.key)}
          <JiraIssueCard {issue} {siteUrl} />
        {/each}
      {/if}
    {:else if view.action === "download_attachment"}
      <AtlassianResourceRow
        icon="file"
        id={view.attachmentId}
        title={view.filename ??
          view.attachment?.filename ??
          "Downloaded attachment"}
        detail={joined(
          view.mediaType ?? view.attachment?.mediaType,
          formatBytes(view.bytes ?? view.attachment?.bytes),
        )}
      />
    {:else if view.action === "create_issue"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.issueKey ? `Created ${view.issueKey}` : "Created issue",
        )}
        detail={view.summary}
        tone={outcomeTone()}
      />
    {:else if view.action === "update_issue"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.issueKey ? `Updated ${view.issueKey}` : "Updated issue",
        )}
        detail={view.updatedFields?.length
          ? view.updatedFields.slice(0, 3).join(", ") +
            (view.updatedFields.length > 3
              ? ` · +${view.updatedFields.length - 3} more`
              : "")
          : undefined}
        tone={outcomeTone()}
      />
    {:else if view.action === "manage_comment"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `${past(view.operation)} comment${view.commentId ? ` ${view.commentId}` : ""}`,
        )}
        detail={view.comment?.bodyPreview}
        tone={outcomeTone(view.operation === "delete")}
      />
    {:else if view.action === "manage_worklog"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `${past(view.operation)} worklog${view.worklogId ? ` ${view.worklogId}` : ""}`,
        )}
        detail={joined(
          view.worklog?.timeSpent,
          view.worklog?.started,
          view.worklog?.commentPreview,
        )}
        tone={outcomeTone(view.operation === "delete")}
      />
    {:else if view.action === "manage_issue_link"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.operation === "delete"
            ? `Deleted issue link${view.linkId ? ` ${view.linkId}` : ""}`
            : `Created ${view.linkType ?? "issue"} link`,
        )}
        detail={view.otherIssueKey
          ? `${view.issueKey ?? "Issue"} ↔ ${view.otherIssueKey}`
          : undefined}
        tone={outcomeTone(view.operation === "delete")}
      />
    {:else if view.action === "manage_attachment"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.operation === "delete"
            ? `Deleted attachment${view.attachmentId ? ` ${view.attachmentId}` : ""}`
            : `Uploaded ${view.filename ?? "attachment"}`,
        )}
        detail={view.operation === "delete"
          ? undefined
          : joined(view.issueKey, formatBytes(view.bytes))}
        tone={outcomeTone(view.operation === "delete")}
      />
    {:else if view.action === "manage_sprint"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          `${past(view.operation)} sprint${view.sprintId ? ` ${view.sprintId}` : ""}`,
        )}
        detail={joined(
          view.sprint?.name,
          view.resultingState ?? view.sprint?.state,
          view.sprint?.goal,
        )}
        tone={outcomeTone(view.operation === "delete")}
      />
    {:else if view.action === "manage_backlog"}
      {@const target = view.issueKey ?? "issue"}
      <AtlassianOutcomeRow
        title={outcomeTitle(
          view.operation === "move_to_backlog"
            ? `Moved ${target} to backlog`
            : view.operation === "move_to_sprint"
              ? `Moved ${target} to sprint ${view.sprintId ?? ""}`.trim()
              : view.rankBeforeIssueKey
                ? `Ranked ${target} before ${view.rankBeforeIssueKey}`
                : view.rankAfterIssueKey
                  ? `Ranked ${target} after ${view.rankAfterIssueKey}`
                  : `Updated backlog placement for ${target}`,
        )}
        tone={outcomeTone()}
      />
    {:else if view.action === "transition_issue"}
      {#if view.transition}
        <AtlassianOutcomeRow
          title={outcomeTitle(
            `Transitioned ${view.issueKey ?? "issue"}${view.transition.to ? ` to ${view.transition.to}` : ""}`,
          )}
          detail={view.transition.name}
          tone={outcomeTone()}
        />
      {:else if view.transitions.length > 0}
        {#each view.transitions.slice(0, limit) as transition (transition.id)}
          <JiraTransitionRow {transition} />
        {/each}
      {:else}
        <AtlassianOutcomeRow
          title={`No transitions available for ${view.issueKey ?? "issue"}.`}
        />
      {/if}
    {:else}
      <AtlassianOutcomeRow
        title={`Completed ${operationLabel(view.action)}`}
        detail="Open Details for the complete response."
      />
    {/if}
  </AtlassianResultSurface>
{:else if fallbackSummary}
  <ToolArgumentBody
    body={{ kind: "atlassian-summary", text: fallbackSummary }}
  />
{/if}
