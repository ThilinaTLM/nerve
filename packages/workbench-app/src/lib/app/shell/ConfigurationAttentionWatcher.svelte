<script lang="ts">
import { untrack } from "svelte";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import {
  attentionSignature,
  attentionToastTitle,
} from "$lib/application/configuration-attention/configuration-attention";
import { configurationAttention as attention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { notify } from "$lib/application/notifications/notify.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { workspaceSelectors } from "$lib/application/workspace";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

/** Events after which a resource may have become broken, pending or fine. */
const CHANGE_EVENTS = [
  "extensions.changed",
  "settings.updated",
  "agentProfiles.changed",
  "launchCatalog.changed",
  "project.configuration.health",
  "project.permissions.updated",
  "prompt_suggestions.trust_updated",
  "prompt_suggestions.enabled_updated",
  "prompt_suggestions.created",
] as const;

/** The set last toasted, per project, so switching projects does not repeat it. */
const toasted: Record<string, string> = {};

$effect(() => {
  const dispose = [
    ...CHANGE_EVENTS.map((type) =>
      onEvent(type, () => attention.refreshSoon()),
    ),
    onWorkbenchReconnect(() => void attention.refresh()),
  ];
  return () => {
    for (const stop of dispose) stop();
  };
});

$effect(() => {
  const projectId = workspaceSelectors.activeProject?.id;
  const ready =
    workbenchStartupState.progressiveActive &&
    workspaceState.connection === "connected";
  untrack(() => {
    attention.reset(projectId);
    if (ready) void attention.refresh(projectId);
  });
});

$effect(() => {
  if (!attention.loaded) return;
  const entries = attention.entries;
  const key = attention.projectId ?? "";
  const signature = attentionSignature(entries);
  if (toasted[key] === signature) return;
  toasted[key] = signature;
  if (!signature) return;
  const project = untrack(() => workspaceSelectors.activeProject);
  notify.warning(attentionToastTitle(entries, project?.name), {
    duration: 8000,
    // The entries are already in Activity; the toast only points there.
    activity: false,
    action: { label: "View", onClick: () => activityInbox.setOpen(true) },
  });
});
</script>

<!--
  Headless: reads what is broken or waits for the user for the active project,
  reads again when configuration changes, and raises a short toast when the set
  changes. The entries live in the activity list and in settings. This comment
  follows the script because the formatter empties a file that is only a script.
-->
