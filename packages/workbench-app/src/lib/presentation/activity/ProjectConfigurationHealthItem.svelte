<!-- Persistent activity entry: one block per project configuration issue. -->
<script lang="ts">
import Info from "@lucide/svelte/icons/info";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";
import { issueMessage } from "./project-configuration-message";
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
</script>

<section
  class="grid gap-1 py-1"
  aria-label="Project configuration"
  data-testid="project-configuration-health"
>
  {#each issues as issue (`${issue.projectId}:${issue.type}`)}
    <div
      class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-md py-2 pl-0.5 pr-1"
    >
      {#if issue.classification === "migrated"}
        <Info class="mt-0.5 size-4 text-info" aria-hidden="true" />
      {:else}
        <TriangleAlert class="mt-0.5 size-4 text-warning" aria-hidden="true" />
      {/if}
      <div class="grid min-w-0 gap-2">
        <p class="text-sm font-medium">
          {issue.label}
          {#if projectName(issue.projectId)}
            <span class="font-normal text-muted-foreground">
              · {projectName(issue.projectId)}</span
            >
          {/if}
        </p>
        <p class="text-xs break-words text-muted-foreground">
          {issueMessage(issue)}
        </p>
        {#if issue.classification !== "migrated" && issue.classification !== "legacy"}
          <p class="text-xs text-muted-foreground">
            Nerve is using defaults until this is fixed.
          </p>
        {/if}
        {#if issue.classification === "legacy"}
          <ul class="grid gap-1">
            {#each issue.files ?? [] as file (file)}
              <li class="font-mono text-xs break-all text-muted-foreground">
                {file}
              </li>
            {/each}
          </ul>
        {:else}
          <code class="font-mono text-xs break-all text-muted-foreground"
            >{issue.path}</code
          >
        {/if}
        <ProjectConfigurationActions
          {issue}
          {pending}
          {onOpen}
          {onReload}
          {onReset}
        />
      </div>
    </div>
  {/each}
  {#if error}
    <p role="alert" class="px-1 text-xs text-destructive">{error}</p>
  {/if}
</section>
