<!-- Open file / Reload / Reset (or Dismiss for migrated) for one configuration issue. -->
<script lang="ts">
import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";
import { Button } from "@nervekit/ui-kit/components/ui/button";

let {
  issue,
  pending = false,
  onOpen,
  onReload,
  onReset,
}: {
  issue: ProjectConfigurationIssue;
  pending?: boolean;
  onOpen: (issue: ProjectConfigurationIssue) => void;
  onReload: (issue: ProjectConfigurationIssue) => void;
  onReset: (issue: ProjectConfigurationIssue) => void;
} = $props();
</script>

<div class="flex flex-wrap gap-2">
  {#if issue.classification === "migrated"}
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onclick={() => onReload(issue)}>Dismiss</Button
    >
  {:else}
    <Button size="sm" variant="outline" onclick={() => onOpen(issue)}
      >Open file</Button
    >
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onclick={() => onReload(issue)}>Reload</Button
    >
    {#if issue.classification === "corrupted" && issue.resetOffered}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onclick={() => onReset(issue)}>Reset</Button
      >
    {/if}
  {/if}
</div>
