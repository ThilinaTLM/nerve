<!-- Ghost-button row of an issue's actions, for surfaces outside the Notifications popover. -->
<script lang="ts">
import type { ProjectConfigurationIssue } from "@nervekit/contracts/projects";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { projectConfigurationActions } from "./project-configuration-message";

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
const actions = $derived(
  projectConfigurationActions(issue, pending, { onOpen, onReload, onReset }),
);
</script>

{#each actions as action (action.label)}
  <Button
    size="sm"
    variant="ghost"
    class="text-muted-foreground"
    disabled={action.disabled}
    onclick={action.onSelect}>{action.label}</Button
  >
{/each}
