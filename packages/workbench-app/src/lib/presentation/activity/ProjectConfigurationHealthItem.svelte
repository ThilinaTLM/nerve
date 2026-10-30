<!-- Persistent notification entries: one per project configuration issue. -->
<script lang="ts">
import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";
import NotificationEntry from "./NotificationEntry.svelte";
import {
  displayPath,
  issueMessage,
  projectConfigurationActions,
} from "./project-configuration-message";

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
    <NotificationEntry
      tone={issue.classification === "migrated"
        ? "info"
        : issue.classification === "corrupted"
          ? "failed"
          : "warning"}
      title={issue.label}
      titleHint={hint(issue)}
      context={[
        projectName(issue.projectId),
        issue.classification === "migrated"
          ? "Upgraded to the current format"
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ")}
      detail={issue.classification === "migrated"
        ? undefined
        : issueMessage(issue)}
      actions={issue.classification === "migrated"
        ? []
        : projectConfigurationActions(issue, pending, {
            onOpen,
            onReload,
            onReset,
          })}
      onDismiss={issue.classification === "migrated" && !pending
        ? () => onReload(issue)
        : undefined}
    />
  {/each}
  {#if error}
    <NotificationEntry
      tone="failed"
      title="Couldn't update project configuration"
      detail={error}
    />
  {/if}
</section>
