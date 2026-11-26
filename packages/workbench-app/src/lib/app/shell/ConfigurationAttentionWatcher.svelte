<script lang="ts">
import { untrack } from "svelte";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import {
  attentionSignature,
  attentionToastTitle,
  groupAttention,
} from "$lib/application/configuration-attention/configuration-attention";
import { configurationAttention as attention } from "$lib/application/configuration-attention/configuration-attention-state.svelte";
import { attentionIsland } from "$lib/application/attention-island/attention-island-state.svelte";
import { attentionIslandModel as island } from "$lib/app/shell/attention-island-model.svelte";
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
  "mcp.changed",
  "project.configuration.health",
  "project.permissions.updated",
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

// Files change without an event (an edit in the editor, a pull), so opening the list reads again.
$effect(() => {
  if (activityInbox.open) untrack(() => void attention.refresh());
});

// Items waiting for trust arrive in the bell island and the transcript
// marker; the toast is left to items that do not work.
$effect(() => {
  if (!attention.loaded) return;
  const entries = groupAttention(attention.entries).broken;
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

// Feeds the island: new trust items and conversations waiting arrive; what
// waited already at startup or on switching projects is quiet. Every read
// also reads the waiting items' reviews again, for their risk lines.
$effect(() => {
  if (!attention.loaded) return;
  void attention.resources;
  const scope = attention.projectId ?? "";
  const items = island.trustItems;
  untrack(() => {
    attentionIsland.observeTrust(
      scope,
      items.map((item) => item.key),
    );
    attentionIsland.readReviews(items);
  });
});

$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  const items = island.waiting.map((entry) => ({
    key: entry.id,
    conversationId: entry.conversationId,
  }));
  // The conversation the user is looking at, not merely the last selected one.
  const tab = workspaceSelectors.activeCenterTab;
  const open = tab?.kind === "conversation" ? tab.id : undefined;
  untrack(() => attentionIsland.observeConversations(items, open));
});

$effect(() => {
  const present = {
    trust: new Set(island.trustItems.map((item) => item.key)),
    conversations: new Set(island.waiting.map((entry) => entry.id)),
  };
  untrack(() => attentionIsland.prune(present));
});

// Files change without an event (an editor, a pull, a script): coming back to
// the window reads again, so a new item arrives where the user looks.
function readOnReturn(): void {
  if (attention.loaded && document.visibilityState === "visible")
    attention.refreshSoon();
}
</script>

<svelte:window onfocus={readOnReturn} />
<svelte:document onvisibilitychange={readOnReturn} />

<!--
  Headless: reads what is broken or waits for the user for the active project,
  reads again when configuration changes, and raises a short toast when the set
  of items that do not work changes. Feeds the bell island's arrivals. The entries live in the activity list and in settings. This comment
  follows the script because the formatter empties a file that is only a script.
-->
