<script lang="ts">
import type { AccessSession } from "@nervekit/contracts/access";
import AccessBlockedView from "$lib/features/access/views/AccessBlockedView.svelte";
import PairingView from "$lib/features/access/views/PairingView.svelte";
import PasskeyEnrollView from "$lib/features/access/views/PasskeyEnrollView.svelte";
import PasskeyLoginView from "$lib/features/access/views/PasskeyLoginView.svelte";
import GalleryGroup from "../GalleryGroup.svelte";
import GallerySpecimen from "../GallerySpecimen.svelte";

const noop = async () => {};
const rejects = async () => {
  throw new Error("The pairing code was not accepted.");
};
const blocked: AccessSession = {
  authenticated: false,
  principal: "none",
  secureTransport: false,
  pairingAvailable: false,
  pairingBlockedReason: "plaintext_transport",
  passkey: {
    required: false,
    enrolled: false,
    loginAvailable: false,
    enrollmentOpen: false,
  },
  legacyBearerSeen: false,
};
</script>

<GalleryGroup
  title="Before the app loads"
  description="Full-page screens shown to an unauthenticated browser."
>
  <GallerySpecimen
    title="PairingView"
    description="Pairing code and device name. The code is prefilled when the visitor arrived through a #pair= link."
    source="features/access/views/PairingView"
    usage="1 file · access"
    layout="bare"
  >
    <div class="grid gap-4 xl:grid-cols-2">
      <div class="h-96 overflow-auto rounded-md border bg-background">
        <PairingView
          initialDeviceName="Chrome on Android"
          onPair={noop}
          onUsePasskey={noop}
        />
      </div>
      <div class="h-96 overflow-auto rounded-md border bg-background">
        <PairingView
          initialCode="ABCD-EFGH"
          initialDeviceName="Chrome on Android"
          onPair={rejects}
        />
      </div>
    </div>
  </GallerySpecimen>

  <GallerySpecimen
    title="PasskeyLoginView"
    description="Passkey sign-in for a server behind its public URL."
    source="features/access/views/PasskeyLoginView"
    usage="1 file · access"
    layout="bare"
  >
    <div class="h-96 overflow-auto rounded-md border bg-background">
      <PasskeyLoginView
        initialDeviceName="Safari on macOS"
        onLogin={noop}
        onUsePairing={noop}
      />
    </div>
  </GallerySpecimen>

  <GallerySpecimen
    title="PasskeyEnrollView"
    description="First passkey enrollment with the setup code printed by the daemon."
    source="features/access/views/PasskeyEnrollView"
    usage="1 file · access"
    layout="bare"
  >
    <div class="h-96 overflow-auto rounded-md border bg-background">
      <PasskeyEnrollView initialDeviceName="Firefox on Linux" onEnroll={noop} />
    </div>
  </GallerySpecimen>

  <GallerySpecimen
    title="AccessBlockedView"
    description="Shown when the connection is not encrypted and nothing can sign in."
    source="features/access/views/AccessBlockedView"
    usage="1 file · access"
    layout="bare"
  >
    <div class="h-96 overflow-auto rounded-md border bg-background">
      <AccessBlockedView session={blocked} onRetry={() => undefined} />
    </div>
  </GallerySpecimen>
</GalleryGroup>
