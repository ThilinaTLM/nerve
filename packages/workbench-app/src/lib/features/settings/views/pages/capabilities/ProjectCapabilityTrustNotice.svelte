<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import type { CapabilityTrust } from "@nervekit/contracts/capabilities";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { SettingsInlineMessage } from "$lib/presentation/settings";

type Props = {
  trust: CapabilityTrust;
  onTrust?: (trusted: boolean) => void;
};

let { trust, onTrust }: Props = $props();
</script>

<!-- Only states that need a decision take a full row; a trusted file is
     represented by the toolbar's revoke action. -->
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
{/if}
