<!--
  Connect a phone over Tailscale: a QR code that opens Nerve's tailnet address
  and pairs the phone in one scan, next to the steps and the plain address.
-->
<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import type { PairingCode } from "@nervekit/contracts/access";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { createPairingCode } from "../api/access.api";
import { describeAccessError } from "../state/access-errors";
import QrCode from "./QrCode.svelte";

/** Long enough to find the phone and open the camera. */
const CODE_TTL_SECONDS = 300;

let { url }: { url: string } = $props();

let code = $state<PairingCode | undefined>();
let error = $state<string | undefined>();
let now = $state(Date.now());

const pairUrl = $derived(
  code ? new URL(`/#pair=${code.code}`, url).href : undefined,
);
const address = $derived(new URL(url).origin);
const secondsLeft = $derived(
  code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0,
);
const expired = $derived(Boolean(code) && secondsLeft === 0);

async function generate() {
  error = undefined;
  try {
    code = await createPairingCode("mobile", CODE_TTL_SECONDS);
    now = Date.now();
  } catch (cause) {
    code = undefined;
    error = describeAccessError(cause);
  }
}

$effect(() => {
  void url;
  void generate();
  const timer = setInterval(() => (now = Date.now()), 1000);
  return () => clearInterval(timer);
});

function remaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0
    ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
    : `${seconds}s`;
}
</script>

<div class="flex flex-wrap items-center gap-6 py-2">
  <div class="grid justify-items-center gap-2">
    {#if pairUrl}
      <div class={expired ? "opacity-40" : undefined}>
        <QrCode value={pairUrl} label="QR code that connects your phone" />
      </div>
    {:else}
      <div class="grid size-48 place-items-center">
        {#if !error}<Spinner />{/if}
      </div>
    {/if}
    {#if expired || error}
      <Button variant="outline" size="sm" onclick={() => void generate()}>
        <RefreshCw /> New code
      </Button>
    {:else if code}
      <span class="text-caption text-muted-foreground">
        Works once · {remaining(secondsLeft)} left
      </span>
    {/if}
  </div>

  <div class="grid min-w-0 flex-1 basis-64 gap-3 text-ui">
    <p class="font-medium text-foreground">Connect your phone</p>
    <ol class="grid list-decimal gap-1.5 pl-5 text-muted-foreground">
      <li>
        Install Tailscale on your phone and sign in with the same account.
      </li>
      <li>Scan this code with the phone's camera.</li>
      <li>Add Nerve to the home screen to get notifications.</li>
    </ol>
    {#if error}
      <Callout layout="block" tone="destructive" text={error} />
    {/if}
    <div class="flex min-w-0 items-center gap-2">
      <span class="min-w-0 truncate font-mono text-caption" title={address}
        >{address}</span
      >
      <IconAction
        icon={Copy}
        label="Copy address"
        onclick={() => void writeClipboardText(address)}
      />
    </div>
  </div>
</div>
