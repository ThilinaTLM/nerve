<!-- Persistent activity entries: one per project configuration issue. -->
<script lang="ts">
import CircleAlert from "@lucide/svelte/icons/circle-alert";
import Info from "@lucide/svelte/icons/info";
import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";
import ActivityEntry from "./ActivityEntry.svelte";
import { displayPath, issueMessage } from "./project-configuration-message";
import ProjectConfigurationActions from "./ProjectConfigurationActions.svelte";

let {
  issues,
  projectName,
  pending = false,
  error,
  onOpen,
  onReload,
  onReset,
}: {
  issues: readonly ProjectConfigurationIssue[];
  projectName: (projectId: string) => string | undefined;
  pending?: boolean;
  error?: string;
  onOpen: (issue: ProjectConfigurationIssue) => void;
  onReload: (issue: ProjectConfigurationIssue) => void;
  onReset: (issue: ProjectConfigurationIssue) => void;
} = $props();

function describe(issue: ProjectConfigurationIssue): string {
  const message =
    issue.classification === "migrated"
      ? "Upgraded to the current format"
      : issueMessage(issue);
  return [projectName(issue.projectId), message].filter(Boolean).join(" · ");
}

function hint(issue: ProjectConfigurationIssue): string {
  return issue.classification === "legacy"
    ? (issue.files ?? []).join("\n")
    : `${displayPath(issue.path)}\n${issue.path}`;
}
</script>

<section
  class="grid gap-0"
  aria-label="Project configuration"
  data-testid="project-configuration-health"
>
  {#each issues as issue (`${issue.projectId}:${issue.type}`)}
    <ActivityEntry
      title={issue.label}
      titleHint={hint(issue)}
      description={describe(issue)}
    >
      {#snippet icon()}
        {#if issue.classification === "migrated"}
          <Info class="size-4 text-info" aria-hidden="true" />
        {:else}
          <CircleAlert
            class="size-4 {issue.classification === 'corrupted'
              ? 'text-destructive'
              : 'text-warning'}"
            aria-hidden="true"
          />
        {/if}
      {/snippet}
      {#snippet footer()}
        <ProjectConfigurationActions
          {issue}
          {pending}
          {onOpen}
          {onReload}
          {onReset}
        />
      {/snippet}
    </ActivityEntry>
  {/each}
  {#if error}
    <p role="alert" class="px-0.5 py-2 text-xs text-destructive">{error}</p>
  {/if}
</section>
