<script lang="ts">
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { createSubmitter } from "../state/submitter.svelte";
import AccessCard from "./AccessCard.svelte";

type Props = {
  initialDeviceName: string;
  onLogin: (input: { deviceName: string }) => Promise<void>;
  /** Offered when a pairing code can also be used. */
  onUsePairing?: () => void;
};

let { initialDeviceName, onLogin, onUsePairing }: Props = $props();

// svelte-ignore state_referenced_locally
let deviceName = $state(initialDeviceName);
const submitter = createSubmitter();

function submit(event: SubmitEvent) {
  event.preventDefault();
  const name = deviceName.trim();
  if (!name) return;
  void submitter.run(() => onLogin({ deviceName: name }));
}
</script>

<AccessCard
  title="Sign in to Nerve"
  description="Use your passkey to sign this device in."
>
  <form class="grid gap-4" onsubmit={submit}>
    <div class="grid gap-1.5">
      <Label for="login-device-name">Device name</Label>
      <Input
        id="login-device-name"
        value={deviceName}
        oninput={(event) => (deviceName = event.currentTarget.value)}
        maxlength={80}
        autocomplete="off"
      />
    </div>
    {#if submitter.error}
      <Callout layout="block" tone="destructive" text={submitter.error} />
    {/if}
    <Button type="submit" disabled={!deviceName.trim() || submitter.busy}>
      {#if submitter.busy}<Spinner />{:else}<Fingerprint />{/if}
      Sign in with passkey
    </Button>
  </form>
  {#snippet footer()}
    {#if onUsePairing}
      <Button variant="ghost" onclick={onUsePairing}>Use a pairing code</Button>
    {/if}
  {/snippet}
</AccessCard>
