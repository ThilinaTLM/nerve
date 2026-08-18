<script lang="ts">
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/components/settings";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import AddProviderDialog from "./AddProviderDialog.svelte";

type Props = {
  authProviders?: AuthProviderMetadata[];
};

let { authProviders = [] }: Props = $props();

let addOpen = $state(false);
let pendingRemove = $state<AuthProviderMetadata | undefined>(undefined);

// Custom providers manage their own key in the Custom providers section.
const customIds = $derived(
  new Set(providerCatalogState.customProviders.map((provider) => provider.id)),
);
const reserved = $derived(new Set(customIds));

const apiKeys = $derived(
  authProviders
    .filter(
      (provider) =>
        provider.configured &&
        provider.credentialType === "api_key" &&
        !reserved.has(provider.provider) &&
        !provider.provider.startsWith("atlassian:") &&
        !provider.provider.startsWith("tavily:"),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName)),
);
const excludeProviders = $derived([...reserved]);

async function confirmRemove(): Promise<void> {
  const provider = pendingRemove;
  if (!provider) return;
  try {
    await deleteProviderCredential(provider.provider);
    await loadSettingsPanel();
  } catch {
    // Errors surface through the global event refresh.
  } finally {
    pendingRemove = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="api-keys"
  title="API keys"
  addLabel="Add API key"
  addTourId="setup-auth-add-api-key"
  emptyTitle="No API keys configured"
  emptyDescription="Add a provider API key to authenticate models."
  items={apiKeys}
  listAriaLabel="Configured API keys"
  itemKey={(provider) => provider.provider}
  onAdd={() => (addOpen = true)}
>
  {#snippet row(provider)}
    <SettingsListItem variant="card" title={provider.displayName}>
      {#snippet meta()}
        {#if provider.envVar}
          <span class="truncate font-mono">{provider.envVar}</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (pendingRemove = provider)}>Remove</Button
        >
      {/snippet}
    </SettingsListItem>
  {/snippet}
</SettingsEntityListSection>

<AddProviderDialog
  bind:open={addOpen}
  {authProviders}
  kind="api_key"
  {excludeProviders}
/>

<ConfirmDialog
  open={!!pendingRemove}
  title="Remove API key?"
  description={pendingRemove
    ? `This removes the stored API key for “${pendingRemove.displayName}” from the orchestrator.`
    : ""}
  confirmLabel="Remove"
  destructive
  onConfirm={() => void confirmRemove()}
  onOpenChange={(open) => {
    if (!open) pendingRemove = undefined;
  }}
/>
