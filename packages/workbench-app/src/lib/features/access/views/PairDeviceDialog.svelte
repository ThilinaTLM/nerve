<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { PairingCode } from "@nervekit/contracts/access";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Select from "@nervekit/ui-kit/components/ui/select";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { describeAccessError } from "../state/access-errors";
import { defaultPairingLink, pairingLinks } from "../state/pairing-url";
import QrCode from "./QrCode.svelte";

type Props = {
  open?: boolean;
  /** Whether this page was loaded over a secure transport. */
  secureTransport: boolean;
  createCode: () => Promise<PairingCode>;
};

let { open = $bindable(false), secureTransport, createCode }: Props = $props();

let code = $state<PairingCode | undefined>();
let error = $state<string | undefined>();
let loading = $state(false);
let now = $state(Date.now());

const NETWORK_KEY = "nerve:pairing-network:v1";

const links = $derived(code ? pairingLinks(code, window.location.origin) : []);
let chosenLabel = $state<string | undefined>(readRememberedNetwork());
const link = $derived(
  defaultPairingLink(links, {
    remembered: chosenLabel,
    origin: window.location.origin,
  }),
);
/** `setup`: QR opens the CA install page first, which then pairs. */
let mode = $state<"ready" | "setup">("ready");
const url = $derived(
  mode === "setup" && link?.setupUrl ? link.setupUrl : link?.url,
);

function readRememberedNetwork(): string | undefined {
  try {
    return localStorage.getItem(NETWORK_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function chooseNetwork(label: string) {
  chosenLabel = label;
  try {
    localStorage.setItem(NETWORK_KEY, label);
  } catch {
    // The choice still applies for this dialog.
  }
}
const secondsLeft = $derived(
  code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0,
);
const expired = $derived(Boolean(code) && secondsLeft === 0);

async function generate() {
  loading = true;
  error = undefined;
  try {
    code = await createCode();
  } catch (cause) {
    code = undefined;
    error = describeAccessError(cause);
  } finally {
    loading = false;
  }
}

$effect(() => {
  if (!open) {
    code = undefined;
    error = undefined;
    return;
  }
  void generate();
  now = Date.now();
  const timer = setInterval(() => (now = Date.now()), 1000);
  return () => clearInterval(timer);
});
</script>

<Dialog
  bind:open
  size="sm"
  title="Pair a device"
  description="Scan the QR code with the device's camera, or open the address and enter the code. It works once."
>
  <div class="grid justify-items-center gap-4">
    {#if error}
      <Callout layout="block" tone="destructive" text={error} />
    {:else if loading && !code}
      <Spinner />
    {:else if code && link && url}
      {#if links.length > 1}
        <Select.Root
          type="single"
          value={link.label}
          onValueChange={chooseNetwork}
        >
          <Select.Trigger class="w-full" aria-label="Network"
            ><span>{link.label}</span></Select.Trigger
          >
          <Select.Content>
            {#each links as option (option.url)}
              <Select.Item value={option.label} label={option.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
      {#if link.setupUrl}
        <ToggleGroup.Root
          type="single"
          aria-label="Device setup"
          value={mode}
          onValueChange={(value) =>
            value && (mode = value as "ready" | "setup")}
        >
          <ToggleGroup.Item value="ready">Ready</ToggleGroup.Item>
          <ToggleGroup.Item value="setup"
            >First time on this device</ToggleGroup.Item
          >
        </ToggleGroup.Root>
      {/if}
      <div class={expired ? "opacity-40" : undefined}>
        <QrCode
          value={url}
          label={mode === "setup" && link.setupUrl
            ? "QR code for installing the certificate and pairing"
            : "QR code for pairing a device"}
        />
      </div>
      {#if mode === "setup" && link.setupUrl}
        <span class="text-center text-ui text-muted-foreground">
          Installs Nerve's local certificate so the phone trusts this address,
          then pairs. Only needed once per device.
        </span>
      {/if}
      <span class="font-mono text-title font-medium tracking-wider"
        >{code.code}</span
      >
      <span class="text-ui text-muted-foreground">
        {expired ? "Code expired." : `Expires in ${secondsLeft}s`}
      </span>
      <div class="flex w-full items-center gap-2">
        <span
          class="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground"
          title={url}>{url}</span
        >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy pairing link"
          onclick={() => void writeClipboardText(url)}
        >
          <Copy />
        </Button>
      </div>
      {#if code.links.length === 0 && !secureTransport}
        <Callout
          layout="block"
          tone="warning"
          text="This address isn't HTTPS, so other devices can't pair through it. Open Nerve through its HTTPS address, or set a public URL."
        />
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
    <Button
      variant="outline"
      disabled={loading}
      onclick={() => void generate()}
    >
      <RefreshCw /> New code
    </Button>
  {/snippet}
</Dialog>
