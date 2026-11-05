<script lang="ts">
import type { AccessSession } from "@nervekit/contracts/access";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import AccessCard from "./AccessCard.svelte";

let { session, onRetry }: { session: AccessSession; onRetry: () => void } =
  $props();

const description = $derived(
  session.pairingBlockedReason === "plaintext_transport"
    ? "This connection is not encrypted, so devices can't be paired or signed in over it. Open Nerve through its HTTPS address."
    : "This device can't sign in from here. Open Nerve on the computer that runs it, or use its secure address.",
);
</script>

<AccessCard title="Can't sign in over this connection" {description}>
  <Button variant="outline" onclick={onRetry}>Check again</Button>
</AccessCard>
