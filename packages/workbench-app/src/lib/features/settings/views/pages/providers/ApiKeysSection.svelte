<script lang="ts">
import ProviderIcon from "$lib/presentation/model-picker/ProviderIcon.svelte";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import { SettingsListItem } from "$lib/presentation/settings";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import { loadSettingsPanel } from "$lib/application/settings/settings-actions.svelte";
import {
  SettingsSection,
  SettingsList,
  SettingsEmptyState,
} from "$lib/presentation/settings";
import AddProviderDialog from "./AddProviderDialog.svelte";

type Props = {
  authProviders?: AuthProviderMetadata[];
};

let { authProviders = [] }: Props = $props();

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

<SettingsSection id="api-keys" title="API keys">
  {#snippet actions()}
    <AddProviderDialog
      {authProviders}
      kind="api_key"
      triggerLabel="Add API key"
      triggerTourId="setup-auth-add-api-key"
      {excludeProviders}
    />
  {/snippet}
  {#if apiKeys.length === 0}
    <SettingsEmptyState
      variant="card"
      title="No API keys configured"
      description="Add a provider API key to authenticate models."
    />
  {:else}
    <SettingsList ariaLabel="Configured API keys">
      {#each apiKeys as provider (provider.provider)}
        <SettingsListItem title={provider.displayName}>
          {#snippet leading()}
            <ProviderIcon
              provider={provider.provider}
              class="size-4 shrink-0"
            />
          {/snippet}
          {#snippet detail()}
            {#if provider.envVar}
              <span class="truncate font-mono">{provider.envVar}</span>
            {/if}
          {/snippet}
          {#snippet actions()}
            <IconAction
              icon={Trash2}
              label="Remove API key"
              tone="destructive"
              onclick={() => (pendingRemove = provider)}
            />
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

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
