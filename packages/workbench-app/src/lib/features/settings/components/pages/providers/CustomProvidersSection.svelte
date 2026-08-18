<script lang="ts">
import type { AuthProviderMetadata, CustomProvider } from "$lib/api";
import { deleteCustomProvider } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/components/settings";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import { refreshProviderCatalog } from "$lib/features/settings/state/provider-catalog-actions.svelte";
import SettingsEntityListSection from "../../shared/settings-entity-list-section.svelte";
import CustomProviderDialog from "./CustomProviderDialog.svelte";

type Props = {
  authProviders?: AuthProviderMetadata[];
};

let { authProviders = [] }: Props = $props();

let dialogOpen = $state(false);
let editing = $state<CustomProvider | undefined>(undefined);
let pendingDelete = $state<CustomProvider | undefined>(undefined);

const providers = $derived(
  [...providerCatalogState.customProviders].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  ),
);
const modelCountByProvider = $derived(
  providerCatalogState.modelDefinitions.reduce<Map<string, number>>(
    (map, model) => {
      map.set(model.provider, (map.get(model.provider) ?? 0) + 1);
      return map;
    },
    new Map(),
  ),
);

function keyConfigured(id: string): boolean {
  const meta = authProviders.find((provider) => provider.provider === id);
  return Boolean(meta?.configured && meta.credentialType === "api_key");
}

function openAdd(): void {
  editing = undefined;
  dialogOpen = true;
}

function openEdit(provider: CustomProvider): void {
  editing = provider;
  dialogOpen = true;
}

async function confirmDelete(): Promise<void> {
  const provider = pendingDelete;
  if (!provider) return;
  try {
    await deleteCustomProvider(provider.id);
    await refreshProviderCatalog();
  } catch {
    // Refresh on the next catalog event keeps the UI consistent.
  } finally {
    pendingDelete = undefined;
  }
}
</script>

<SettingsEntityListSection
  sectionId="custom-providers"
  title="Custom providers"
  addLabel="Add provider"
  addTourId="setup-auth-add-custom-provider"
  emptyTitle="No custom providers"
  emptyDescription="Add a custom provider to connect a local or self-hosted endpoint."
  items={providers}
  listAriaLabel="Custom providers"
  itemKey={(provider) => provider.id}
  onAdd={openAdd}
>
  {#snippet row(provider)}
    <SettingsListItem variant="card" title={provider.displayName}>
      {#snippet badges()}
        {#if !keyConfigured(provider.id)}
          <Badge tone="neutral" size="xs">No key</Badge>
        {/if}
        <Badge tone="neutral" size="xs">
          {modelCountByProvider.get(provider.id) ?? 0} models
        </Badge>
      {/snippet}
      {#snippet meta()}
        <span class="truncate">
          <span class="font-mono">{provider.id}</span>
          · {provider.api} ·
          <span class="font-mono">{provider.baseUrl}</span>
        </span>
      {/snippet}
      {#snippet actions()}
        <Button variant="ghost" size="xs" onclick={() => openEdit(provider)}
          >Edit</Button
        >
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (pendingDelete = provider)}>Delete</Button
        >
      {/snippet}
    </SettingsListItem>
  {/snippet}
</SettingsEntityListSection>

<CustomProviderDialog
  bind:open={dialogOpen}
  provider={editing}
  hasKey={editing ? keyConfigured(editing.id) : false}
/>

<ConfirmDialog
  open={!!pendingDelete}
  title="Delete custom provider?"
  description={pendingDelete
    ? `This removes “${pendingDelete.displayName}”, its stored API key, and its ${modelCountByProvider.get(pendingDelete.id) ?? 0} model(s).`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => void confirmDelete()}
  onOpenChange={(open) => {
    if (!open) pendingDelete = undefined;
  }}
/>
