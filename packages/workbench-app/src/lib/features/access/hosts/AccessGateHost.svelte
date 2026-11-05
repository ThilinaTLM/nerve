<script lang="ts">
import { onMount, type Snippet } from "svelte";
import {
  accessGate,
  clearPendingPairCode,
  refreshAccessSession,
  startAccessGate,
} from "../state/access-gate.svelte";
import {
  enrollFirstPasskey,
  pairThisDevice,
  signInWithPasskey,
} from "../state/access-actions";
import { canFallBackToPairing } from "../state/access-routing";
import {
  currentUserAgent,
  defaultDeviceName,
  deviceKindFor,
} from "../state/device-identity";
import AccessBlockedView from "../views/AccessBlockedView.svelte";
import PairingView from "../views/PairingView.svelte";
import PasskeyEnrollView from "../views/PasskeyEnrollView.svelte";
import PasskeyLoginView from "../views/PasskeyLoginView.svelte";

let {
  children,
  onGateVisibleChange,
}: {
  children: Snippet;
  /** True while a pairing/login screen replaces the app. */
  onGateVisibleChange?: (visible: boolean) => void;
} = $props();

const userAgent = currentUserAgent();
const kind = deviceKindFor(userAgent);
const suggestedName = defaultDeviceName(userAgent);

/** Lets the visitor switch between login and pairing when both work. */
let preferPairing = $state(false);

onMount(startAccessGate);

const session = $derived(accessGate.session);

$effect(() => {
  if (accessGate.phase === "settled") {
    onGateVisibleChange?.(accessGate.screen !== "app");
  }
});
const showPairing = $derived(
  accessGate.screen === "pair" ||
    (accessGate.screen === "passkey-login" && preferPairing),
);

function usePasskey() {
  preferPairing = false;
  clearPendingPairCode();
  void refreshAccessSession();
}

async function pair(input: { code: string; deviceName: string }) {
  await pairThisDevice({ ...input, kind });
  clearPendingPairCode();
  await refreshAccessSession();
}

async function login(input: { deviceName: string }) {
  await signInWithPasskey({ ...input, kind });
  await refreshAccessSession();
}

async function enroll(input: {
  setupCode: string;
  passkeyName: string;
  deviceName: string;
}) {
  await enrollFirstPasskey({ ...input, kind });
  clearPendingPairCode();
  await refreshAccessSession();
}
</script>

{#if accessGate.phase === "settled" && session}
  {#if accessGate.screen === "app"}
    {@render children()}
  {:else}
    <div class="h-dvh overflow-auto bg-background">
      {#if showPairing}
        <PairingView
          initialCode={accessGate.pendingPairCode}
          initialDeviceName={suggestedName}
          onPair={pair}
          onUsePasskey={session.passkey.loginAvailable ? usePasskey : undefined}
        />
      {:else if accessGate.screen === "passkey-login"}
        <PasskeyLoginView
          initialDeviceName={suggestedName}
          onLogin={login}
          onUsePairing={canFallBackToPairing(session)
            ? () => (preferPairing = true)
            : undefined}
        />
      {:else if accessGate.screen === "passkey-enroll"}
        <PasskeyEnrollView
          initialCode={accessGate.pendingPairCode}
          initialDeviceName={suggestedName}
          onEnroll={enroll}
        />
      {:else}
        <AccessBlockedView
          {session}
          onRetry={() => void refreshAccessSession()}
        />
      {/if}
    </div>
  {/if}
{/if}
