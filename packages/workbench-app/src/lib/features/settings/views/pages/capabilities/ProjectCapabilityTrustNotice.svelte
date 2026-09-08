<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import ShieldOff from "@lucide/svelte/icons/shield-off";
import type { CapabilityTrust } from "@nervekit/contracts/capabilities";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsInlineMessage } from "$lib/presentation/settings";

type Props = {
  trust: CapabilityTrust;
  onTrust?: (trusted: boolean) => void;
};

let { trust, onTrust }: Props = $props();
</script>

{#if trust.status === "untrusted"}
  <SettingsInlineMessage
    tone="warning"
    text={`${trust.reason} Until you trust it on this machine, these overrides are inactive and your user settings apply.`}
  >
    {#snippet actions()}
      <Button size="xs" variant="outline" onclick={() => onTrust?.(true)}>
        <ShieldCheck class="size-3.5" />Trust file
      </Button>
    {/snippet}
  </SettingsInlineMessage>
{:else if trust.status === "invalid"}
  <SettingsInlineMessage tone="destructive" text={trust.reason} />
{:else if trust.status === "trusted"}
  <SettingsInlineMessage
    tone="neutral"
    text={`Project capability file trusted on this machine on ${new Date(trust.trustedAt).toLocaleDateString()}.`}
  >
    {#snippet actions()}
      <Button size="xs" variant="ghost" onclick={() => onTrust?.(false)}>
        <ShieldOff class="size-3.5" />Revoke trust
      </Button>
    {/snippet}
  </SettingsInlineMessage>
{/if}
