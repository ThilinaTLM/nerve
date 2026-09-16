<script lang="ts">
import ShieldOff from "@lucide/svelte/icons/shield-off";
import type { CapabilityTrust } from "@nervekit/contracts/capabilities";
import { Button } from "@nervekit/ui-kit/components/ui/button";

type Props = {
  trust: CapabilityTrust;
  onTrust?: (trusted: boolean) => void;
};

let { trust, onTrust }: Props = $props();
</script>

{#if trust.status === "trusted"}
  <Button
    size="xs"
    variant="ghost"
    class="text-muted-foreground"
    title={`Project capability file trusted on this machine on ${new Date(
      trust.trustedAt,
    ).toLocaleDateString()}.`}
    onclick={() => onTrust?.(false)}
  >
    <ShieldOff class="size-3.5" />Revoke trust
  </Button>
{/if}
