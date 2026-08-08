<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { AuthProviderMetadata, CustomProvider } from "$lib/api";
import { deleteCustomProvider } from "$lib/api";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsList,
  SettingsListItem,
  SettingsToolbar,
} from "$lib/presentation/components/settings";
import { authState } from "$lib/features/auth/state/auth-state.svelte";
import { refreshProviderCatalog } from "$lib/features/auth/state/auth.svelte";
import CustomProviderDialog from "./CustomProviderDialog.svelte";

type Props = {
  authProviders?: AuthProviderMetadata[];
};

let { authProviders = [] }: Props = $props();

let dialogOpen = $state(false);
let editing = $state<CustomProvider | undefined>(undefined);
let pendingDelete = $state<CustomProvider | undefined>(undefined);

const providers = $derived(
  [...authState.customProviders].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  ),
);
const modelCountByProvider = $derived(
  authState.modelDefinitions.reduce<Map<string, number>>((map, model) => {
    map.set(model.provider, (map.get(model.provider) ?? 0) + 1);
    return map;
  }, new Map()),
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

<SettingsToolbar>
  {#snippet end()}
    <Button
      size="sm"
      data-tour-id="setup-auth-add-custom-provider"
      onclick={openAdd}
    >
      <Plus class="size-3.5" aria-hidden="true" />
      Add provider
    </Button>
  {/snippet}
</SettingsToolbar>

<SettingsGroup>
  {#if providers.length === 0}
    <SettingsEmptyState
      title="No custom providers"
      description="Add a custom provider to connect a local or self-hosted endpoint."
    >
      {#snippet actions()}
        <Button
          size="sm"
          data-tour-id="setup-auth-add-custom-provider"
          onclick={openAdd}>Add provider</Button
        >
      {/snippet}
    </SettingsEmptyState>
  {:else}
    <SettingsList ariaLabel="Custom providers">
      {#each providers as provider (provider.id)}
        <SettingsListItem title={provider.displayName}>
          {#snippet badges()}
            <Badge
              tone={keyConfigured(provider.id) ? "good" : "neutral"}
              size="xs"
            >
              {keyConfigured(provider.id) ? "Key set" : "No key"}
            </Badge>
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
            <Button
              variant="ghost"
              size="icon-sm"
              ariaLabel="Edit provider"
              onclick={() => openEdit(provider)}
            >
              <Pencil class="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              ariaLabel="Delete provider"
              onclick={() => (pendingDelete = provider)}
            >
              <Trash2 class="size-3.5" aria-hidden="true" />
            </Button>
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsGroup>

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
