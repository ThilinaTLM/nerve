<script lang="ts">
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import QrCodeIcon from "@lucide/svelte/icons/qr-code";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { DeviceView, Passkey } from "@nervekit/contracts/access";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { onMount } from "svelte";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsListItem,
  SettingsSection,
} from "$lib/presentation/settings";
import { DevicesPageController } from "../state/devices-page.svelte";
import {
  auditEventLabel,
  auditEventTone,
  formatLastSeen,
  kindLabel,
  methodLabel,
} from "../state/device-format";
import PairDeviceDialog from "./PairDeviceDialog.svelte";
import RenameDeviceDialog from "./RenameDeviceDialog.svelte";

const controller = new DevicesPageController();

let pairOpen = $state(false);
let renaming = $state<DeviceView | undefined>();
let renameOpen = $state(false);
let revoking = $state<DeviceView | undefined>();
let revokeOpen = $state(false);
let revokeOthersOpen = $state(false);
let removingPasskey = $state<Passkey | undefined>();
let removePasskeyOpen = $state(false);
let addPasskeyOpen = $state(false);

onMount(() => {
  controller.start();
  return () => controller.dispose();
});

const otherDevices = $derived(
  controller.devices.filter((device) => !device.current),
);
const passkeysEnabled = $derived(
  Boolean(controller.session?.passkey.required || controller.passkeys.length),
);
const now = Date.now();
</script>

{#if controller.errorMessage}
  <Callout layout="block" tone="destructive" text={controller.errorMessage} />
{/if}

{#if controller.legacyBearerSeen}
  <Callout
    layout="block"
    tone="warning"
    icon={ShieldAlert}
    title="A remote client used the daemon token"
    text="Using the daemon token from another machine is deprecated and will stop working. Pair that client as a device instead, then rotate the local token."
  />
{/if}

<SettingsSection
  id="devices"
  title="Devices"
  description="Browsers and apps that can open this Nerve. Each has its own revocable credential."
  surface={false}
>
  {#snippet actions()}
    <Button
      variant="outline"
      size="sm"
      disabled={otherDevices.length === 0}
      onclick={() => (revokeOthersOpen = true)}
    >
      Revoke all others
    </Button>
    <Button size="sm" onclick={() => (pairOpen = true)}>
      <QrCodeIcon /> Pair a device
    </Button>
  {/snippet}
  {#if controller.loading}
    <Skeleton class="h-9 w-full" />
  {:else if controller.devices.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={QrCodeIcon}
      title="No paired devices"
      description="Pair a phone or another browser to open Nerve from it."
    />
  {:else}
    <SettingsList ariaLabel="Devices">
      {#each controller.devices as device (device.id)}
        <SettingsListItem
          title={device.name}
          description={`${kindLabel(device.kind)} · ${methodLabel(device.method)} · ${
            device.current
              ? "active now"
              : `seen ${formatLastSeen(device.lastSeenAt, now)}`
          }`}
        >
          {#snippet status()}
            {#if device.current}<Badge variant="brand">This device</Badge>{/if}
            {#if device.status === "expired"}
              <Badge variant="warning">Expired</Badge>
            {/if}
          {/snippet}
          {#snippet actions()}
            <IconAction
              icon={Pencil}
              label="Rename device"
              onclick={() => {
                renaming = device;
                renameOpen = true;
              }}
            />
            {#if !device.current}
              <IconAction
                icon={Trash2}
                tone="destructive"
                label={device.status === "expired"
                  ? "Dismiss"
                  : "Revoke device"}
                onclick={() => {
                  if (device.status === "expired")
                    void controller.revoke(device.id);
                  else {
                    revoking = device;
                    revokeOpen = true;
                  }
                }}
              />
            {/if}
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

<SettingsSection
  id="passkeys"
  title="Passkeys"
  description={passkeysEnabled
    ? "Passkeys sign devices in when Nerve is reachable at its public URL."
    : "Passkeys are used when Nerve has a public URL. You can enroll them ahead of time."}
  surface={false}
>
  {#snippet actions()}
    <Button variant="outline" size="sm" onclick={() => (addPasskeyOpen = true)}>
      <Plus /> Add passkey
    </Button>
  {/snippet}
  {#if controller.passkeys.length === 0}
    <SettingsEmptyState
      variant="card"
      icon={Fingerprint}
      title="No passkeys"
      description="Add a passkey to sign in without a pairing code."
    />
  {:else}
    <SettingsList ariaLabel="Passkeys">
      {#each controller.passkeys as passkey (passkey.id)}
        <SettingsListItem
          title={passkey.name}
          description={passkey.lastUsedAt
            ? `Last used ${formatLastSeen(passkey.lastUsedAt, now)}`
            : `Added ${new Date(passkey.createdAt).toLocaleDateString()}`}
        >
          {#snippet actions()}
            <IconAction
              icon={Trash2}
              tone="destructive"
              label="Remove passkey"
              onclick={() => {
                removingPasskey = passkey;
                removePasskeyOpen = true;
              }}
            />
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

<SettingsSection
  id="activity"
  title="Recent activity"
  description="Pairing, sign-ins, failed attempts and revocations."
  surface={false}
>
  {#if controller.audit.length === 0}
    <p class="text-ui text-muted-foreground">Nothing recorded yet.</p>
  {:else}
    <SettingsList ariaLabel="Recent access activity">
      {#each controller.audit as event (`${event.at}-${event.type}-${event.deviceId ?? ""}`)}
        <SettingsListItem
          title={auditEventLabel(event)}
          description={[
            new Date(event.at).toLocaleString(),
            event.ip,
            event.detail,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {#snippet status()}
            {#if auditEventTone(event) === "warning"}
              <Badge variant="warning">Attention</Badge>
            {/if}
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

<PairDeviceDialog
  bind:open={pairOpen}
  secureTransport={controller.session?.secureTransport ?? false}
  createCode={() => controller.createPairing()}
/>

<RenameDeviceDialog
  bind:open={renameOpen}
  title="Rename device"
  label="Device name"
  initialName={renaming?.name ?? ""}
  onSubmit={(name) =>
    renaming ? controller.rename(renaming.id, name) : Promise.resolve(false)}
/>

<RenameDeviceDialog
  bind:open={addPasskeyOpen}
  title="Add a passkey"
  label="Passkey name"
  submitLabel="Continue"
  initialName="Passkey"
  onSubmit={(name) => controller.addPasskey(name)}
/>

<ConfirmDialog
  bind:open={revokeOpen}
  destructive
  title={`Revoke ${revoking?.name ?? "device"}?`}
  description="It is signed out immediately and has to be paired again."
  confirmLabel="Revoke"
  onConfirm={() => revoking && void controller.revoke(revoking.id)}
/>

<ConfirmDialog
  bind:open={revokeOthersOpen}
  destructive
  title="Revoke all other devices?"
  description="Every device except this one is signed out immediately."
  confirmLabel="Revoke all others"
  onConfirm={() => void controller.revokeOthers()}
/>

<ConfirmDialog
  bind:open={removePasskeyOpen}
  destructive
  title={`Remove ${removingPasskey?.name ?? "passkey"}?`}
  description="You can no longer sign in with it. The last passkey can't be removed while a public URL is set."
  confirmLabel="Remove"
  onConfirm={() =>
    removingPasskey && void controller.removePasskey(removingPasskey.id)}
/>
