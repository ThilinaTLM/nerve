<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { AuthProviderMetadata } from "$lib/api";
import { deleteProviderCredential } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  SettingsEmptyState,
  SettingsList,
  SettingsListItem,
  SettingsSection,
} from "$lib/presentation/components/settings";
import { providerCatalogState } from "$lib/features/settings/state/provider-catalog-state.svelte";
import { loadSettingsPanel } from "$lib/features/settings/state/settings-actions.svelte";
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

<SettingsSection id="api-keys" title="API keys">
  {#snippet actions()}
    <Button
      size="xs"
      data-tour-id="setup-auth-add-api-key"
      onclick={() => (addOpen = true)}
    >
      <Plus class="size-3.5" aria-hidden="true" />
      Add API key
    </Button>
  {/snippet}

  {#if apiKeys.length === 0}
    <SettingsEmptyState
      class="rounded-md border border-dashed border-border/60 bg-muted/20 px-3"
      title="No API keys configured"
      description="Add a provider API key to authenticate models."
    />
  {:else}
    <SettingsList ariaLabel="Configured API keys" class="grid gap-2 divide-y-0">
      {#each apiKeys as provider (provider.provider)}
        <SettingsListItem
          title={provider.displayName}
          class="rounded-md border border-border/60 bg-card/40 px-3 py-2"
        >
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
      {/each}
    </SettingsList>
  {/if}
</SettingsSection>

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
