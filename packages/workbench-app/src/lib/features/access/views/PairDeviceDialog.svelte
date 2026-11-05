<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { PairingCode } from "@nervekit/contracts/access";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { describeAccessError } from "../state/access-errors";
import { pairingUrl } from "../state/pairing-url";
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

const url = $derived(
  code ? pairingUrl(code, window.location.origin) : undefined,
);
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
    {:else if code && url}
      <div class={expired ? "opacity-40" : undefined}>
        <QrCode value={url} label="QR code for pairing a device" />
      </div>
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
      {#if !code.url && !secureTransport}
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
