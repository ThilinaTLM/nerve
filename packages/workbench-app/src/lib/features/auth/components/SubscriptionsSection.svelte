<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsListItem,
  SettingsToolbar,
} from "$lib/presentation/components/settings";
import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
import AddProviderDialog from "./AddProviderDialog.svelte";

type Props = {
  authProviders?: AuthProviderMetadata[];
};

let { authProviders = [] }: Props = $props();

let addOpen = $state(false);
let pendingLogout = $state<AuthProviderMetadata | undefined>(undefined);

const subscriptions = $derived(
  authProviders
    .filter(
      (provider) => provider.configured && provider.credentialType === "oauth",
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);

async function confirmLogout(): Promise<void> {
  const provider = pendingLogout;
  if (!provider) return;
  try {
    await deleteProviderCredential(provider.provider);
    await loadAuthPanel();
  } catch {
    // Errors surface through the global event refresh; keep the UI responsive.
  } finally {
    pendingLogout = undefined;
  }
}
</script>

<SettingsToolbar>
  {#snippet end()}
    <Button size="sm" onclick={() => (addOpen = true)}>
      <Plus class="size-3.5" aria-hidden="true" />
      Connect subscription
    </Button>
  {/snippet}
</SettingsToolbar>

<SettingsGroup>
  {#if subscriptions.length === 0}
    <SettingsEmptyState
      title="No subscriptions connected"
      description="Connect a subscription to authenticate models."
    >
      {#snippet actions()}
        <Button size="sm" onclick={() => (addOpen = true)}
          >Connect subscription</Button
        >
      {/snippet}
    </SettingsEmptyState>
  {:else}
    <SettingsList ariaLabel="Connected subscriptions">
      {#each subscriptions as provider (provider.provider)}
        <SettingsListItem title={provider.displayName}>
          {#snippet meta()}
            <span class="truncate"
              >{provider.oauthName ?? provider.provider}</span
            >
            <Badge tone="good" size="xs">Connected</Badge>
          {/snippet}
          {#snippet actions()}
            <Button
              variant="ghost"
              size="xs"
              onclick={() => (pendingLogout = provider)}>Log out</Button
            >
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>

    {#each subscriptions.filter((provider) => provider.warning) as provider (provider.provider)}
      <SettingsInlineMessage
        tone="warning"
        text={`${provider.displayName}: ${provider.warning}`}
      />
    {/each}
  {/if}
</SettingsGroup>

<AddProviderDialog bind:open={addOpen} {authProviders} kind="oauth" />

<ConfirmDialog
  open={!!pendingLogout}
  title="Log out of provider?"
  description={pendingLogout
    ? `This removes the stored subscription login for “${pendingLogout.displayName}” from the orchestrator.`
    : ""}
  confirmLabel="Log out"
  destructive
  onConfirm={() => void confirmLogout()}
  onOpenChange={(open) => {
    if (!open) pendingLogout = undefined;
  }}
/>
