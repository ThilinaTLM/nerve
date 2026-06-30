<script lang="ts">
  import type { ToolCallDisplayRecord, ToolView } from "$lib/features/tools/views/tool-result-view";
  import { COLLAPSED_LINES } from "$lib/features/tools/views/tool-result-view";

  type JiraView = Extract<ToolView, { kind: "jira" }>;
  type JiraIssue = JiraView["issues"][number];
  type JiraTransition = JiraView["transitions"][number];

  type Props = {
    toolCall: ToolCallDisplayRecord;
    view: JiraView;
    expanded?: boolean;
  };
  let { toolCall, view, expanded = false }: Props = $props();

  const issueRows = $derived.by(() => {
    const rows = view.issue ? [view.issue, ...view.issues.filter((issue) => issue.key !== view.issue?.key)] : view.issues;
    return expanded ? rows : rows.slice(0, COLLAPSED_LINES);
  });
  const transitionRows = $derived(
    expanded ? view.transitions : view.transitions.slice(0, COLLAPSED_LINES),
  );
  const messageLines = $derived(
    expanded ? view.messageLines : view.messageLines.slice(0, COLLAPSED_LINES),
  );
  const updatedFields = $derived(
    expanded ? (view.updatedFields ?? []) : (view.updatedFields ?? []).slice(0, COLLAPSED_LINES),
  );
  const hasStructuredBody = $derived(
    messageLines.length > 0 || issueRows.length > 0 || transitionRows.length > 0 || updatedFields.length > 0,
  );

  function statusText(): string {
    if (toolCall.status === "running" || toolCall.status === "requested") {
      switch (view.action) {
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

  function issueChips(issue: JiraIssue): string[] {
    return [issue.issueType, issue.status, issue.priority, issue.assignee ? `assignee ${issue.assignee}` : undefined, issue.updated]
      .filter((value): value is string => Boolean(value));
  }

  function transitionLabel(transition: JiraTransition): string {
    return transition.name ?? "(unnamed)";
  }
</script>

{#if hasStructuredBody}
  <div class="grid gap-2">
    {#if messageLines.length > 0}
      <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs leading-normal text-sidebar-foreground">
        {#each messageLines as line, index (`message-${index}`)}
          <p class="m-0 break-words">{line}</p>
        {/each}
      </div>
    {/if}

    {#if issueRows.length > 0}
      <div class="grid gap-1.5">
        {#each issueRows as issue (issue.key)}
          <div class="grid gap-1 rounded-sm border bg-sidebar px-2.5 py-2">
            <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span class="font-mono text-xs font-semibold text-primary">{issue.key}</span>
              {#if issue.summary}
                <span class="min-w-0 break-words text-xs font-medium leading-snug text-sidebar-foreground">{issue.summary}</span>
              {/if}
            </div>
            {#if issueChips(issue).length > 0}
              <div class="flex flex-wrap gap-1">
                {#each issueChips(issue) as chip (chip)}
                  <span class="rounded-sm border bg-muted/30 px-1.5 py-0.5 text-xs text-muted-foreground">{chip}</span>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if transitionRows.length > 0}
      <div class="grid gap-1.5">
        {#each transitionRows as transition (transition.id)}
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 rounded-sm border bg-sidebar px-2.5 py-2">
            <span class="font-mono text-xs font-semibold text-primary">{transition.id}</span>
            <span class="text-xs font-medium text-sidebar-foreground">{transitionLabel(transition)}</span>
            {#if transition.to}
              <span class="text-xs text-muted-foreground">→ {transition.to}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if updatedFields.length > 0}
      <div class="flex flex-wrap gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
        {#each updatedFields as field (field)}
          <span class="rounded-sm border bg-muted/30 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{field}</span>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="rounded-sm border bg-sidebar px-2.5 py-2 text-xs text-muted-foreground">
    {statusText()}
  </div>
{/if}
