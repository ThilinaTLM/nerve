<!--
  Headless: loads project configuration health for the active project, applies
  health events, raises a short toast when the set of failing files changes and
  hosts the reset confirmation. The persistent items live in the activity list
  and the launches panel.
-->
<script lang="ts">
import { untrack } from "svelte";
import { projectConfigurationHealthSchema } from "@nervekit/contracts/projects";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  failingSignature,
  failingToastTitle,
} from "$lib/application/project-configuration/project-configuration-health";
import { projectConfigurationHealth as health } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

let toasted = "";

$effect(() => {
  const dispose = [
    onEvent("project.configuration.health", (event) => {
      const parsed = projectConfigurationHealthSchema.safeParse(event.data);
      if (parsed.success) health.apply(parsed.data);
    }),
    onWorkbenchReconnect(() => {
      for (const projectId of Object.keys(health.byProject))
        void health.refresh(projectId);
    }),
  ];
  return () => {
    for (const stop of dispose) stop();
  };
});

$effect(() => {
  const projectId = workspaceSelectors.activeProject?.id;
  if (
    projectId &&
    workbenchStartupState.progressiveActive &&
    workspaceState.connection === "connected"
  )
    untrack(() => void health.refresh(projectId));
});

$effect(() => {
  const signature = failingSignature(health.byProject);
  if (signature === toasted) return;
  toasted = signature;
  if (!signature) return;
  notify.warning(failingToastTitle(health.byProject), {
    duration: 8000,
    action: { label: "View", onClick: () => activityInbox.setOpen(true) },
  });
});

const target = $derived(health.resetTarget);
</script>

<ConfirmDialog
  open={target !== undefined}
  title={`Reset ${target ? target.label.toLowerCase() : "configuration"}?`}
  description={`${target?.resetDescription ?? ""} The original file is kept in quarantine.`}
  confirmLabel="Reset"
  destructive
  onOpenChange={(open) => {
    if (!open) health.resetTarget = undefined;
  }}
  onConfirm={() => {
    if (target) void health.reset(target);
  }}
/>
