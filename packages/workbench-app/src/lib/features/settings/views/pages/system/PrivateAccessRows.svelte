<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import { ToggleRow } from "@nervekit/ui-kit/components/composites/page";
import SelectField from "@nervekit/ui-kit/components/composites/select-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { TunnelStatus } from "@nervekit/contracts/access";
import type { TunnelHttpsPort } from "@nervekit/contracts/access";
import { describeTunnel } from "$lib/application/access/tunnel-view";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { SettingsSelectRow } from "$lib/presentation/settings";

type Leaf<T> = { activeValue: T; savedValue: T; editable: boolean };

type Props = {
  enabled: Leaf<boolean>;
  httpsPort: Leaf<TunnelHttpsPort>;
  status: TunnelStatus | undefined;
  onSave: (tunnel: { enabled: boolean; httpsPort: TunnelHttpsPort }) => void;
};

let { enabled, httpsPort, status, onSave }: Props = $props();

const portItems = [
  { value: "443", label: "Default (443)" },
  { value: "8443", label: "8443" },
  { value: "10000", label: "10000" },
];

const value = (leaf: Leaf<unknown>) =>
  leaf.editable ? leaf.savedValue : leaf.activeValue;
const isEnabled = $derived(Boolean(value(enabled)));
const port = $derived(value(httpsPort) as TunnelHttpsPort);
const view = $derived(describeTunnel(status));

function save(next: Partial<{ enabled: boolean; httpsPort: TunnelHttpsPort }>) {
  onSave({ enabled: isEnabled, httpsPort: port, ...next });
}
</script>

<ToggleRow
  label="Private access (Tailscale)"
  description="Open Nerve from your phone anywhere on your tailnet over trusted HTTPS. Requires Tailscale."
  checked={isEnabled}
  disabled={!enabled.editable}
  onCheckedChange={(next) => save({ enabled: next })}
/>
{#if isEnabled}
  <SettingsSelectRow
    label="Tailscale HTTPS port"
    description="Port 443 gives an address without a port number."
    disabled={!httpsPort.editable}
  >
    {#snippet control(disabled)}
      <SelectField
        items={portItems}
        value={String(port)}
        ariaLabel="Tailscale HTTPS port"
        {disabled}
        onValueChange={(next) =>
          save({ httpsPort: Number(next) as TunnelHttpsPort })}
      />
    {/snippet}
  </SettingsSelectRow>
  <div class="flex flex-col gap-2 text-ui" aria-live="polite">
    <p class={view.tone === "warning" ? "text-warning" : ""}>{view.summary}</p>
    {#if view.detail}
      <p class="text-muted-foreground">{view.detail}</p>
    {/if}
    {#each [view.url, view.command] as text, index (index)}
      {#if text}
        <div class="flex items-center gap-2">
          <span
            class="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground"
            title={text}>{text}</span
          >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={index === 0 ? "Copy address" : "Copy command"}
            onclick={() => void writeClipboardText(text)}
          >
            <Copy />
          </Button>
        </div>
      {/if}
    {/each}
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
          <Button variant="outline" size="sm" onclick={() => save({})}>
            Try again
          </Button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
