<!--
  Settings › Remote: how phones and other computers reach this
  Nerve. Tailscale first (works anywhere, nothing to install on the phone
  besides Tailscale), then the same-network listener.
-->
<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import QrCodeIcon from "@lucide/svelte/icons/qr-code";
import { ToggleRow } from "@nervekit/ui-kit/components/composites/page";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { TunnelHttpsPort, TunnelStatus } from "@nervekit/contracts/access";
import type {
  ApplicationConfigurationSnapshot,
  UpdateApplicationConfigurationRequest,
} from "@nervekit/contracts/settings";
import { describeTunnel } from "$lib/application/access/tunnel-view";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import {
  pendingRestarts,
  RestartNeededCallout,
  SettingsFieldRow,
  SettingsSection,
  SettingsSelectRow,
} from "$lib/presentation/settings";
import { createPairingCode } from "../api/access.api";
import PairDeviceDialog from "./PairDeviceDialog.svelte";
import TailscalePhoneCard from "./TailscalePhoneCard.svelte";

type Props = {
  configuration?: ApplicationConfigurationSnapshot;
  tunnel?: TunnelStatus;
  canRestartDaemon?: boolean;
  daemonRestarting?: boolean;
  onConfigurationChange?: (
    patch: UpdateApplicationConfigurationRequest,
  ) => void;
  onRestartDaemon?: () => void;
  onOpenDevices?: () => void;
};

let {
  configuration,
  tunnel,
  canRestartDaemon = false,
  daemonRestarting = false,
  onConfigurationChange,
  onRestartDaemon,
  onOpenDevices,
}: Props = $props();

type Leaf<T> = {
  activeValue: T;
  savedValue: T;
  editable: boolean;
  source: { kind: string; name?: string };
};

const value = <T>(leaf: Leaf<T>): T =>
  leaf.editable ? leaf.savedValue : leaf.activeValue;

/** Settings fixed by a flag or environment variable say so. */
function lockedBy(leaf: Leaf<unknown>): string | undefined {
  return leaf.editable
    ? undefined
    : `Set by ${leaf.source.name ?? leaf.source.kind}.`;
}

const portItems = [
  { value: "443", label: "443 (no port in the address)" },
  { value: "8443", label: "8443" },
  { value: "10000", label: "10000" },
];

const network = $derived(configuration?.application.network);
const tunnelOn = $derived(
  network ? Boolean(value(network.tunnelEnabled)) : false,
);
const tunnelPort = $derived(
  network ? (value(network.tunnelHttpsPort) as TunnelHttpsPort) : 443,
);
const view = $derived(describeTunnel(tunnel));
const lanOn = $derived(network ? Boolean(value(network.allowRemote)) : false);
const httpsOn = $derived(network ? Boolean(value(network.mobileHttps)) : false);

let pairOpen = $state(false);

function saveNetwork(
  patch: NonNullable<
    NonNullable<UpdateApplicationConfigurationRequest["application"]>["network"]
  >,
) {
  onConfigurationChange?.({ application: { network: patch } });
}

function saveTunnel(
  next: Partial<{ enabled: boolean; httpsPort: TunnelHttpsPort }>,
) {
  saveNetwork({
    tunnel: { enabled: tunnelOn, httpsPort: tunnelPort, ...next },
  });
}
</script>

{#if configuration && network}
  <RestartNeededCallout
    {...pendingRestarts(configuration, ["network"])}
    canRestart={canRestartDaemon}
    restarting={daemonRestarting}
    onRestart={onRestartDaemon}
  />

  <SettingsSection
    id="tailscale"
    title="Anywhere, with Tailscale"
    description="Recommended. Only devices signed in to your Tailscale account can reach Nerve, and nothing is exposed to the internet."
  >
    <ToggleRow
      label="Private access"
      description={lockedBy(network.tunnelEnabled) ??
        "Needs Tailscale on this computer and on your phone."}
      checked={tunnelOn}
      disabled={!network.tunnelEnabled.editable}
      onCheckedChange={(enabled) => saveTunnel({ enabled })}
    />
    {#if tunnelOn}
      {#if tunnel?.state === "ready"}
        <TailscalePhoneCard url={tunnel.url} />
      {:else}
        <div class="grid gap-2 text-ui" aria-live="polite">
          <p class={view.tone === "warning" ? "text-warning" : ""}>
            {view.summary}
          </p>
          {#if view.detail}
            <p class="text-muted-foreground">{view.detail}</p>
          {/if}
          {#if view.command}
            {@const command = view.command}
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="min-w-0 truncate font-mono text-caption"
                title={command}>{command}</span
              >
              <IconAction
                icon={Copy}
                label="Copy command"
                onclick={() => void writeClipboardText(command)}
              />
            </div>
          {/if}
          {#if view.link || view.retry}
            <div class="flex gap-2">
              {#if view.link}
                {@const link = view.link}
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => window.open(link.href, "_blank", "noopener")}
                >
                  {link.label}
                </Button>
              {/if}
              {#if view.retry}
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => saveTunnel({})}
                >
                  Try again
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      <SettingsSelectRow
        label="Port"
        description="Change it only if another service already uses this port on Tailscale."
        disabled={!network.tunnelHttpsPort.editable}
      >
        {#snippet control(disabled)}
          <SelectField
            items={portItems}
            value={String(tunnelPort)}
            ariaLabel="Tailscale port"
            {disabled}
            onValueChange={(next) =>
              saveTunnel({ httpsPort: Number(next) as TunnelHttpsPort })}
          />
        {/snippet}
      </SettingsSelectRow>
    {/if}
  </SettingsSection>

  <SettingsSection
    id="local-network"
    title="On the same network"
    description="For phones and computers on your Wi-Fi or home network."
  >
    {#snippet actions()}
      {#if lanOn}
        <Button size="sm" variant="outline" onclick={() => (pairOpen = true)}>
          <QrCodeIcon /> Pair a device
        </Button>
      {/if}
    {/snippet}
    <ToggleRow
      label="Allow devices on this network"
      description={lockedBy(network.allowRemote) ??
        "Each device pairs once with a code from this computer."}
      checked={lanOn}
      disabled={!network.allowRemote.editable}
      onCheckedChange={(allowRemote) => saveNetwork({ allowRemote })}
    />
    {#if lanOn}
      <ToggleRow
        label="HTTPS for phones"
        description={lockedBy(network.mobileHttps) ??
          "Lets a phone install Nerve as an app. The phone trusts Nerve's certificate once while pairing."}
        checked={httpsOn}
        disabled={!network.mobileHttps.editable}
        onCheckedChange={(mobileHttps) => saveNetwork({ mobileHttps })}
      />
      {#if httpsOn}
        <SettingsFieldRow
          id="settings-https-port"
          label="HTTPS port"
          type="number"
          min={1}
          max={65535}
          value={String(value(network.httpsPort))}
          disabled={!network.httpsPort.editable}
          hint={lockedBy(network.httpsPort)}
          onValueChange={(next) => {
            const httpsPort = Number(next);
            if (Number.isInteger(httpsPort) && httpsPort >= 1)
              saveNetwork({ httpsPort });
          }}
        />
      {/if}
    {/if}
  </SettingsSection>

  {#if onOpenDevices}
    <div class="flex items-center justify-between gap-3 text-ui">
      <span class="text-muted-foreground"
        >See and revoke the phones and browsers you paired.</span
      >
      <Button variant="outline" size="sm" onclick={onOpenDevices}>
        Manage devices
      </Button>
    </div>
  {/if}

  <PairDeviceDialog
    bind:open={pairOpen}
    secureTransport={window.location.protocol === "https:"}
    createCode={() => createPairingCode("mobile")}
  />
{/if}
