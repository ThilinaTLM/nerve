<script lang="ts">
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  SettingsInlineMessage,
  SettingsListItem,
} from "$lib/presentation/settings";
import { loadSettingsPanel } from "$lib/application/settings/settings-actions.svelte";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
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

<SettingsEntityListSection
  sectionId="subscriptions"
  title="Subscriptions"
  addLabel="Connect subscription"
  addTourId="setup-auth-connect-subscription"
  emptyTitle="No subscriptions connected"
  emptyDescription="Connect a subscription to authenticate models."
  items={subscriptions}
  listAriaLabel="Connected subscriptions"
  itemKey={(provider) => provider.provider}
  onAdd={() => (addOpen = true)}
>
  {#snippet row(provider)}
    <SettingsListItem
      variant="card"
      title={provider.displayName}
      tourId={provider.provider === "openai-codex"
        ? "setup-auth-openai-codex-connected"
        : undefined}
    >
      {#snippet meta()}
        <span class="truncate">{provider.oauthName ?? provider.provider}</span>
      {/snippet}
      {#snippet actions()}
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (pendingLogout = provider)}>Log out</Button
        >
      {/snippet}
    </SettingsListItem>
  {/snippet}
  {#snippet below()}
    {#each subscriptions.filter((provider) => provider.warning) as provider (provider.provider)}
      <SettingsInlineMessage
        tone="warning"
        text={`${provider.displayName}: ${provider.warning}`}
      />
    {/each}
  {/snippet}
</SettingsEntityListSection>

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
