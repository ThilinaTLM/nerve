<script lang="ts">
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { AuthProviderMetadata, CustomProvider } from "$lib/api";
  import { deleteCustomProvider } from "$lib/api";
  import { Badge } from "@nervekit/workbench-ui/components/ui/badge";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import ConfirmDialog from "@nervekit/workbench-ui/components/ui/confirm-dialog";
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

  function openAdd() {
    editing = undefined;
    dialogOpen = true;
  }

  function openEdit(provider: CustomProvider) {
    editing = provider;
    dialogOpen = true;
  }

  async function confirmDelete() {
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

<section id="auth-custom-providers" class="settings-section" data-section="custom-providers">
  <header class="settings-section-header">
    <h2>Custom providers</h2>
  </header>

  <div class="settings-section-body">
    <div class="settings-row providers-summary">
      <Button size="sm" onclick={openAdd}>
        <Plus size={15} strokeWidth={2.2} />
        Add provider
      </Button>
    </div>

    {#if providers.length === 0}
      <p class="settings-note">Add a custom provider to connect a local or self-hosted endpoint.</p>
    {:else}
      <ul class="provider-list">
        {#each providers as provider (provider.id)}
          <li class="provider-item">
            <div class="provider-item-text">
              <strong>{provider.displayName}</strong>
              <span>{provider.id} · {provider.api} · {provider.baseUrl}</span>
            </div>
            <div class="provider-item-actions">
              <Badge tone={keyConfigured(provider.id) ? "good" : "neutral"} size="sm">
                {keyConfigured(provider.id) ? "Key set" : "No key"}
              </Badge>
              <Badge tone="neutral" size="sm">
                {modelCountByProvider.get(provider.id) ?? 0} models
              </Badge>
              <Button variant="ghost" size="icon-sm" ariaLabel="Edit provider" onclick={() => openEdit(provider)}>
                <Pencil size={14} strokeWidth={2} />
              </Button>
              <Button variant="ghost" size="icon-sm" ariaLabel="Delete provider" onclick={() => (pendingDelete = provider)}>
                <Trash2 size={14} strokeWidth={2} />
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

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

<style>
  .providers-summary {
    align-items: center;
  }

  .provider-list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .provider-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 0.6rem 0.75rem;
  }

  .provider-item-text {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .provider-item-text strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .provider-item-text > span {
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .provider-item-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.4rem;
  }
</style>
