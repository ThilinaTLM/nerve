<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  SettingsEmptyState,
  SettingsInlineMessage,
  SettingsList,
  SettingsListItem,
  SettingsSection,
} from "$lib/presentation/components/settings";
import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
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
    await loadSettingsPanel();
  } catch {
    // Errors surface through the global event refresh; keep the UI responsive.
  } finally {
    pendingLogout = undefined;
  }
}
</script>

<SettingsSection id="subscriptions" title="Subscriptions">
  {#snippet actions()}
    <Button
      size="xs"
      data-tour-id="setup-auth-connect-subscription"
      onclick={() => (addOpen = true)}
    >
      <Plus class="size-3.5" aria-hidden="true" />
      Connect subscription
    </Button>
  {/snippet}

  {#if subscriptions.length === 0}
    <SettingsEmptyState
      class="rounded-md border border-dashed border-border/60 bg-muted/20 px-3"
      title="No subscriptions connected"
      description="Connect a subscription to authenticate models."
    />
  {:else}
    <SettingsList
      ariaLabel="Connected subscriptions"
      class="grid gap-2 divide-y-0"
    >
      {#each subscriptions as provider (provider.provider)}
        <SettingsListItem
          class="rounded-md border border-border/60 bg-card/40 px-3 py-2"
          title={provider.displayName}
          tourId={provider.provider === "openai-codex"
            ? "setup-auth-openai-codex-connected"
            : undefined}
        >
          {#snippet meta()}
            <span class="truncate"
              >{provider.oauthName ?? provider.provider}</span
            >
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
</SettingsSection>

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
