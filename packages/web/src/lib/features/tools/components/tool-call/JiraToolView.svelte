<script lang="ts">
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import type { JiraIssueSummaryPayload } from "@nervekit/shared";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import { COLLAPSED_LINES } from "$lib/features/tools/views/tool-result-view";
  import JiraBanner from "./JiraBanner.svelte";
  import JiraFieldRow from "./JiraFieldRow.svelte";
  import JiraIssueCard from "./JiraIssueCard.svelte";
  import JiraMetricStrip from "./JiraMetricStrip.svelte";
  import JiraProjectHeader from "./JiraProjectHeader.svelte";
  import JiraTransitionRow from "./JiraTransitionRow.svelte";
  import JiraUserCard from "./JiraUserCard.svelte";

  type JiraView = Extract<ToolView, { kind: "jira" }>;

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: JiraView;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();

  // Per-action collapsed row budgets anchored on the shared COLLAPSED_LINES (10)
  // so long Jira responses never flood the card. The Details dialog passes
  // expanded=true to reveal the full (backend-capped) set.
  const ISSUE_LIMIT = COLLAPSED_LINES;
  const USER_LIMIT = COLLAPSED_LINES;
  const FIELD_LIMIT = 8;
  const TRANSITION_LIMIT = 8;
  const TRANSITION_LIST_TRANSITIONS = 6;
  const TRANSITION_LIST_FIELDS = 4;
  const UPDATED_FIELD_LIMIT = 12;

  const siteUrl = $derived(settingsState.settingsDraft?.tools?.jira?.siteUrl);

  function cap<T>(items: T[], limit: number): T[] {
    return expanded ? items : items.slice(0, limit);
  }

  // Header issue: prefer the structured summary, else synthesize a minimal card.
  const headerIssue = $derived.by<JiraIssueSummaryPayload | undefined>(() => {
    if (view.issue) return view.issue;
    if (!view.issueKey) return undefined;
    return {
      key: view.issueKey,
      summary: view.summary,
      issueType: view.issueType,
    };
  });

  const assigneeFallback = $derived(view.resolvedAssignee?.displayName);
  const bannerText = $derived(view.messageLines[0]);
  const updatedFields = $derived(cap(view.updatedFields ?? [], UPDATED_FIELD_LIMIT));

  function fallbackText(): string {
    if (toolCall.status === "running" || toolCall.status === "requested") {
      switch (view.action) {
        case "search_users":
          return "Searching Jira users…";
        case "search_issues":
          return "Searching Jira issues…";
        case "get_issue":
          return "Fetching Jira issue…";
        case "get_project":
          return "Fetching Jira project…";
        case "create_issue":
          return "Creating Jira issue…";
        case "update_issue":
          return "Updating Jira issue…";
        case "add_comment":
          return "Adding Jira comment…";
        case "transition_issue":
          return "Checking Jira transitions…";
      }
    }
    return "No Jira summary available. Open Details for raw arguments and result.";
  }

  // Whether the chosen action branch will render any structured content.
  const hasBody = $derived.by(() => {
    switch (view.action) {
      case "search_issues":
        return view.issues.length > 0;
      case "search_users":
        return view.users.length > 0;
      case "get_issue":
        return Boolean(headerIssue) || view.transitions.length > 0;
      case "get_project":
        return Boolean(view.project) || view.fields.length > 0;
      case "create_issue":
      case "update_issue":
      case "add_comment":
        return Boolean(bannerText || headerIssue);
      case "transition_issue":
        return Boolean(
          bannerText || view.transition || view.transitions.length > 0,
        );
      default:
        return false;
    }
  });
</script>

{#if hasBody}
  <div class="grid gap-2">
    {#if view.action === "search_issues"}
      {#each cap(view.issues, ISSUE_LIMIT) as issue (issue.key)}
        <JiraIssueCard {issue} {siteUrl} />
      {/each}

    {:else if view.action === "search_users"}
      {#each cap(view.users, USER_LIMIT) as user (user.accountId)}
        <JiraUserCard {user} />
      {/each}

    {:else if view.action === "get_issue"}
      {#if headerIssue}
        <JiraIssueCard issue={headerIssue} {siteUrl} />
      {/if}
      {#if view.includedCounts}
        <JiraMetricStrip counts={view.includedCounts} />
      {/if}
      {#if view.transitions.length > 0}
        <span class="text-xs font-medium text-muted-foreground">Transitions</span>
        {#each cap(view.transitions, TRANSITION_LIMIT) as transition (transition.id)}
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
        <span class="text-xs font-medium text-muted-foreground">Fields</span>
        {#each cap(view.fields, FIELD_LIMIT) as field (field.id)}
          <JiraFieldRow {field} />
        {/each}
      {/if}

    {:else if view.action === "create_issue"}
      {#if bannerText}
        <JiraBanner
          text={bannerText}
          tone={view.dryRun ? "info" : "success"}
          icon={view.dryRun ? FlaskConical : CircleCheck}
        />
      {/if}
      {#if headerIssue}
        <JiraIssueCard issue={headerIssue} {siteUrl} {assigneeFallback} />
      {/if}

    {:else if view.action === "update_issue"}
      {#if bannerText}
        <JiraBanner
          text={bannerText}
          tone={view.dryRun ? "info" : "success"}
          icon={view.dryRun ? FlaskConical : CircleCheck}
        />
      {/if}
      {#if updatedFields.length > 0}
        <div class="grid gap-1">
          <span class="text-xs font-medium text-muted-foreground">Updated fields</span>
          <div class="flex flex-wrap gap-1.5">
            {#each updatedFields as field (field)}
              <span class="rounded-sm border bg-sidebar px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{field}</span>
            {/each}
          </div>
        </div>
      {/if}
      {#if view.issue}
        <JiraIssueCard issue={view.issue} {siteUrl} {assigneeFallback} />
      {/if}

    {:else if view.action === "add_comment"}
      {#if bannerText}
        <JiraBanner text={bannerText} icon={MessageSquare} />
      {/if}

    {:else if view.action === "transition_issue"}
      {#if view.transition}
        <JiraBanner
          text={view.dryRun
            ? `Preview — ${view.issueKey ?? "issue"} would transition`
            : `Transitioned ${view.issueKey ?? "issue"}`}
          tone={view.dryRun ? "info" : "success"}
          icon={view.dryRun ? FlaskConical : CircleCheck}
        />
        <JiraTransitionRow transition={view.transition} />
      {:else if view.transitions.length > 0}
        <span class="text-xs font-medium text-muted-foreground">Available transitions</span>
        {#each cap(view.transitions, TRANSITION_LIST_TRANSITIONS) as transition (transition.id)}
          <JiraTransitionRow {transition} />
        {/each}
        {#if view.fields.length > 0}
          <span class="text-xs font-medium text-muted-foreground">Transition fields</span>
          {#each cap(view.fields, TRANSITION_LIST_FIELDS) as field (field.id)}
            <JiraFieldRow {field} />
          {/each}
        {/if}
      {/if}
    {/if}
  </div>
{:else}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-muted-foreground">
    {fallbackText()}
  </div>
{/if}
