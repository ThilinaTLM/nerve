<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { createSubmitter } from "../state/submitter.svelte";
import { normalizePairingCode } from "../state/pair-fragment";
import AccessCard from "./AccessCard.svelte";

type Props = {
  /** Code lifted from the `#pair=` fragment, if any. */
  initialCode?: string;
  initialDeviceName: string;
  onPair: (input: { code: string; deviceName: string }) => Promise<void>;
  /** Offered when passkey login is also possible here. */
  onUsePasskey?: () => void;
};

let { initialCode, initialDeviceName, onPair, onUsePasskey }: Props = $props();

// svelte-ignore state_referenced_locally
let codeText = $state(initialCode ?? "");
// svelte-ignore state_referenced_locally
let deviceName = $state(initialDeviceName);
const submitter = createSubmitter();

const code = $derived(normalizePairingCode(codeText));
const canSubmit = $derived(Boolean(code) && deviceName.trim().length > 0);

function submit(event: SubmitEvent) {
  event.preventDefault();
  if (!code || !canSubmit) return;
  void submitter.run(() => onPair({ code, deviceName: deviceName.trim() }));
}
</script>

<AccessCard
  title="Pair this device"
  description="Enter the code shown in Nerve on your computer (Settings → Devices → Pair a device)."
>
  <form class="grid gap-4" onsubmit={submit}>
    <div class="grid gap-1.5">
      <Label for="pair-code">Pairing code</Label>
      <Input
        id="pair-code"
        value={codeText}
        oninput={(event) => (codeText = event.currentTarget.value)}
        placeholder="XXXX-XXXX"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck={false}
        class="uppercase"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="pair-device-name">Device name</Label>
      <Input
        id="pair-device-name"
        value={deviceName}
        oninput={(event) => (deviceName = event.currentTarget.value)}
        maxlength={80}
        autocomplete="off"
      />
    </div>
    {#if submitter.error}
      <Callout layout="block" tone="destructive" text={submitter.error} />
    {/if}
    <Button type="submit" disabled={!canSubmit || submitter.busy}>
      {#if submitter.busy}<Spinner />{/if}
      Pair device
    </Button>
  </form>
  {#snippet footer()}
    {#if onUsePasskey}
      <Button variant="ghost" onclick={onUsePasskey}
        >Sign in with a passkey</Button
      >
    {/if}
  {/snippet}
</AccessCard>
