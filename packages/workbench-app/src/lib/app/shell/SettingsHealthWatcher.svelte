<!--
  Headless: loads settings health once the workbench is connected, raises a
  short toast when the set of failing files changes, and hosts the reset
  confirmation. The persistent item lives in the activity list.
-->
<script lang="ts">
import { untrack } from "svelte";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  settingsHealthSignature,
  settingsHealthToastTitle,
} from "$lib/application/settings/settings-health";
import { settingsHealth } from "$lib/application/settings/settings-health-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";

let toasted = "";

$effect(() => {
  if (
    workbenchStartupState.progressiveActive &&
    workspaceState.connection === "connected"
  )
    untrack(() => void settingsHealth.refresh());
});

$effect(() => {
  const health = settingsHealth.notice.health;
  const signature = settingsHealthSignature(health);
  if (signature === toasted) return;
  toasted = signature;
  if (!signature) return;
  notify.warning(settingsHealthToastTitle(health), {
    duration: 8000,
    action: { label: "View", onClick: () => activityInbox.setOpen(true) },
  });
});

const resetId = $derived(settingsHealth.resetId);
</script>

<ConfirmDialog
  open={resetId !== undefined}
  title={`Reset ${resetId ?? "settings"} to defaults?`}
  description={`This changes the active settings. The original file will be kept in quarantine.${resetId === "harness" || resetId === "permissions" ? " Resetting authorization settings ends the recovery approval safeguard once both documents are valid; the configured permission policy will apply." : ""}`}
  confirmLabel="Reset to defaults"
  onOpenChange={(open) => {
    if (!open) settingsHealth.resetId = undefined;
  }}
  onConfirm={() => {
    if (resetId) void settingsHealth.resolve({ id: resetId, action: "reset" });
  }}
/>
