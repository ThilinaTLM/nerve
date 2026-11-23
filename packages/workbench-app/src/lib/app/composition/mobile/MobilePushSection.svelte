<script lang="ts">
import { untrack } from "svelte";
import Bell from "@lucide/svelte/icons/bell";
import BellRing from "@lucide/svelte/icons/bell-ring";
import { MobileListRow, MobileSection } from "$lib/presentation/shell";
import {
  disablePushNotifications,
  enablePushNotifications,
  loadPushNotifications,
  pushNotifications,
  sendTestPushNotification,
} from "$lib/features/access";
import { pushStatusLabel } from "$lib/platform/push/push-status";

/**
 * Web Push for this phone: Nerve notifies you when no screen is in use.
 * Only offered to paired devices; the desktop app has native notifications.
 */
const status = $derived(pushNotifications.status);
const detail = $derived(
  pushNotifications.error ??
    (pushNotifications.loading ? "Checking" : pushStatusLabel[status]),
);
const toggleable = $derived(
  !pushNotifications.loading && (status === "off" || status === "on"),
);

$effect(() => {
  untrack(() => void loadPushNotifications());
});

function toggle(): void {
  void (status === "on"
    ? disablePushNotifications()
    : enablePushNotifications());
}
</script>

<MobileSection title="Notifications">
  <MobileListRow
    title="Notifications on this phone"
    {detail}
    icon={Bell}
    chevron={false}
    onclick={toggleable && !pushNotifications.busy ? toggle : undefined}
  />
  {#if status === "on"}
    <MobileListRow
      title="Send test notification"
      icon={BellRing}
      chevron={false}
      onclick={() => void sendTestPushNotification()}
    />
  {/if}
</MobileSection>
