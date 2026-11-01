<!-- Inline notice when the launch definitions file is corrupted or incompatible. -->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { issueMessage } from "$lib/presentation/activity/project-configuration-message";
import { projectConfigurationHealth as health } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import ProjectConfigurationActions from "$lib/presentation/activity/ProjectConfigurationActions.svelte";

let { projectId }: { projectId: string | undefined } = $props();

const issue = $derived(
  health
    .issuesFor(projectId)
    .find(
      (item) =>
        item.type === "launch-definitions" &&
        item.classification !== "migrated",
    ),
);
</script>

{#if issue}
  <Callout layout="strip" tone="warning" icon={TriangleAlert}>
    <p class="font-medium">Launch definitions can't be loaded</p>
    <p class="break-words">{issueMessage(issue)} No launches are shown.</p>
    <div class="-ml-1.5 flex flex-wrap py-1">
      <ProjectConfigurationActions
        {issue}
        pending={health.pending}
        onOpen={(item) => void health.open(item)}
        onReload={(item) => void health.reload(item)}
        onReset={(item) => health.requestReset(item)}
      />
    </div>
  </Callout>
{/if}
