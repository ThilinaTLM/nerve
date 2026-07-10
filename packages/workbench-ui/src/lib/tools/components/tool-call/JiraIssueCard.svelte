<script lang="ts">
import Clock from "@lucide/svelte/icons/clock";
import ExternalLink from "@lucide/svelte/icons/external-link";
import User from "@lucide/svelte/icons/user";
import type { JiraIssueSummaryPayload } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import type { BadgeTone } from "@nervekit/ui-kit/components/ui/badge";
import {
  dateTimeLabel,
  relativeTimeLabel,
} from "@nervekit/ui-kit/core/utils/time";
import { jiraIssueUrl, jiraStatusTone } from "../../views/jira-display";
import { jiraIssueTypeIcon, jiraPriorityMeta } from "../../views/jira-icons";

type Props = {
  issue: JiraIssueSummaryPayload;
  siteUrl?: string;
  assigneeFallback?: string;
};
let { issue, siteUrl, assigneeFallback }: Props = $props();

const url = $derived(jiraIssueUrl(siteUrl, issue.key));
const TypeIcon = $derived(jiraIssueTypeIcon(issue.issueType));
const statusTone = $derived(jiraStatusTone(issue.status, issue.statusCategory));
const priority = $derived(jiraPriorityMeta(issue.priority));
const assignee = $derived(issue.assignee ?? assigneeFallback);
const updatedRel = $derived(relativeTimeLabel(issue.updated));
const hasChips = $derived(
  Boolean(issue.status || issue.priority || assignee || updatedRel),
);

const toneText: Record<NonNullable<BadgeTone>, string> = {
  neutral: "text-muted-foreground",
  accent: "text-foreground",
  running: "text-info",
  good: "text-success",
  warn: "text-warning",
  danger: "text-destructive",
};
const priorityColor = $derived(
  priority ? toneText[priority.tone ?? "neutral"] : "text-muted-foreground",
);
</script>

<div class="grid gap-1.5 rounded-sm border bg-sidebar px-2.5 py-2">
  <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
    <span class="inline-flex items-center gap-1.5">
      <TypeIcon
        size={13}
        strokeWidth={2}
        class="shrink-0 text-muted-foreground"
        aria-label={issue.issueType}
      />
      {#if url}
        <a
          class="inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary no-underline hover:underline"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          title={`Open ${issue.key} in Jira`}
        >
          {issue.key}
          <ExternalLink size={11} strokeWidth={2} class="opacity-70" />
        </a>
      {:else}
        <span class="font-mono text-xs font-semibold text-primary"
          >{issue.key}</span
        >
      {/if}
    </span>
    {#if issue.summary}
      <span
        class="min-w-0 break-words text-xs font-medium leading-snug text-sidebar-foreground"
        >{issue.summary}</span
      >
    {/if}
  </div>

  {#if hasChips}
    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {#if issue.status}
        <Badge tone={statusTone} size="xs">{issue.status}</Badge>
      {/if}
      {#if priority}
        {@const PriorityIcon = priority.icon}
        <span
          class={`inline-flex items-center gap-1 text-xs ${priorityColor}`}
          title={`Priority: ${issue.priority}`}
        >
          <PriorityIcon size={13} strokeWidth={2.2} />
          {issue.priority}
        </span>
      {/if}
      {#if assignee}
        <span
          class="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <User size={12} strokeWidth={2} class="shrink-0" />
          <span class="truncate">{assignee}</span>
        </span>
      {/if}
      {#if updatedRel}
        <span
          class="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"
          title={`Updated ${dateTimeLabel(issue.updated)}`}
        >
          <Clock size={12} strokeWidth={2} />
          {updatedRel}
        </span>
      {/if}
    </div>
  {/if}
</div>
