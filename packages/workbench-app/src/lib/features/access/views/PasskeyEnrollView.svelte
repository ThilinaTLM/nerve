<script lang="ts">
import Fingerprint from "@lucide/svelte/icons/fingerprint";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { createSubmitter } from "../state/submitter.svelte";
import { normalizePairingCode } from "../state/pair-fragment";
import AccessCard from "./AccessCard.svelte";

type Props = {
  initialCode?: string;
  initialDeviceName: string;
  onEnroll: (input: {
    setupCode: string;
    passkeyName: string;
    deviceName: string;
  }) => Promise<void>;
};

let { initialCode, initialDeviceName, onEnroll }: Props = $props();

// svelte-ignore state_referenced_locally
let codeText = $state(initialCode ?? "");
// svelte-ignore state_referenced_locally
let deviceName = $state(initialDeviceName);
// svelte-ignore state_referenced_locally
let passkeyName = $state(initialDeviceName);
const submitter = createSubmitter();

const setupCode = $derived(normalizePairingCode(codeText));
const canSubmit = $derived(
  Boolean(setupCode) && deviceName.trim() !== "" && passkeyName.trim() !== "",
);

function submit(event: SubmitEvent) {
  event.preventDefault();
  if (!setupCode || !canSubmit) return;
  void submitter.run(() =>
    onEnroll({
      setupCode,
      passkeyName: passkeyName.trim(),
      deviceName: deviceName.trim(),
    }),
  );
}
</script>

<AccessCard
  title="Set up a passkey"
  description="This Nerve is reachable from the internet and needs a passkey before anything else can sign in. Enter the setup code printed by the daemon, or run `nerve pair --enroll` on the host."
>
  <form class="grid gap-4" onsubmit={submit}>
    <div class="grid gap-1.5">
      <Label for="setup-code">Setup code</Label>
      <Input
        id="setup-code"
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
      <Label for="setup-passkey-name">Passkey name</Label>
      <Input
        id="setup-passkey-name"
        value={passkeyName}
        oninput={(event) => (passkeyName = event.currentTarget.value)}
        maxlength={80}
        autocomplete="off"
      />
    </div>
    <div class="grid gap-1.5">
      <Label for="setup-device-name">Device name</Label>
      <Input
        id="setup-device-name"
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
      {#if submitter.busy}<Spinner />{:else}<Fingerprint />{/if}
      Create passkey
    </Button>
  </form>
</AccessCard>
