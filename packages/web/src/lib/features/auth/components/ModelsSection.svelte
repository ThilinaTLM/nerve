<script lang="ts">
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type {
    AuthProviderMetadata,
    ModelDefinition,
    ModelInfo,
  } from "$lib/api";
  import { deleteModelDefinition } from "$lib/api";
  import { Badge } from "@nervekit/ui/components/ui/badge";
  import { Button } from "@nervekit/ui/components/ui/button";
  import ConfirmDialog from "@nervekit/ui/components/ui/confirm-dialog";
  import { authState } from "$lib/features/auth/state/auth-state.svelte";
  import { refreshProviderCatalog } from "$lib/features/auth/state/auth.svelte";
  import ModelDefinitionDialog from "./ModelDefinitionDialog.svelte";

  type Props = {
    models?: ModelInfo[];
    authProviders?: AuthProviderMetadata[];
  };

  let { models = [], authProviders = [] }: Props = $props();

  let dialogOpen = $state(false);
  let editing = $state<ModelDefinition | undefined>(undefined);
  let pendingDelete = $state<ModelDefinition | undefined>(undefined);

  const customProviderIds = $derived(
    new Set(authState.customProviders.map((custom) => custom.id)),
  );
  const modelProviderIds = $derived(
    new Set(
      models.filter((model) => !model.faux).map((model) => model.provider),
    ),
  );
  const authenticatedBuiltInProviders = $derived(
    authProviders
      .filter(
        (provider) =>
          provider.configured &&
          modelProviderIds.has(provider.provider) &&
          !customProviderIds.has(provider.provider),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const providerItems = $derived([
    ...authState.customProviders
      .map((custom) => ({
        value: custom.id,
        label: custom.displayName,
        detail: "Custom provider",
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...authenticatedBuiltInProviders.map((provider) => ({
      value: provider.provider,
      label: provider.displayName,
      detail:
        provider.credentialType === "oauth"
          ? "Subscription login"
          : "API key configured",
    })),
  ]);
  const eligibleProviderIds = $derived(
    new Set(providerItems.map((provider) => provider.value)),
  );

  const definitions = $derived(
    [...authState.modelDefinitions].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        a.name.localeCompare(b.name),
    ),
  );

  function providerLabel(id: string): string {
    return (
      authState.customProviders.find((custom) => custom.id === id)
        ?.displayName ??
      authProviders.find((provider) => provider.provider === id)?.displayName ??
      id
    );
  }

  function isUnavailable(model: ModelDefinition): boolean {
    return !eligibleProviderIds.has(model.provider);
  }

  function openAdd() {
    if (providerItems.length === 0) return;
    editing = undefined;
    dialogOpen = true;
  }

  function openEdit(model: ModelDefinition) {
    editing = model;
    dialogOpen = true;
  }

  async function confirmDelete() {
    const model = pendingDelete;
    if (!model) return;
    try {
      await deleteModelDefinition(model.provider, model.modelId);
      await refreshProviderCatalog();
    } catch {
      // Catalog events keep the list in sync on failure.
    } finally {
      pendingDelete = undefined;
    }
  }
</script>

<section id="auth-custom-models" class="settings-section" data-section="custom-models">
  <header class="settings-section-header">
    <h2>Custom models</h2>
  </header>

  <div class="settings-section-body">
    <div class="settings-row providers-summary">
      <Button size="sm" onclick={openAdd} disabled={providerItems.length === 0}>
        <Plus size={15} strokeWidth={2.2} />
        Add model
      </Button>
    </div>

    {#if definitions.length === 0}
      {#if providerItems.length === 0}
        <p class="settings-note">Authenticate a provider before adding custom models.</p>
      {:else}
        <p class="settings-note">Add a model to expose it in the composer picker.</p>
      {/if}
    {:else}
      <ul class="provider-list">
        {#each definitions as model (`${model.provider}:${model.modelId}`)}
          <li class="provider-item" class:orphan={isUnavailable(model)}>
            <div class="provider-item-text">
              <strong>{model.name}</strong>
              <span>{providerLabel(model.provider)} · {model.modelId}</span>
            </div>
            <div class="provider-item-actions">
              {#if isUnavailable(model)}
                <span class="orphan-tag"><TriangleAlert size={13} strokeWidth={2} /> Unavailable</span>
              {/if}
              {#if model.reasoning}
                <Badge tone="accent" size="sm">Reasoning</Badge>
              {/if}
              <Button variant="ghost" size="icon-sm" ariaLabel="Edit model" onclick={() => openEdit(model)}>
                <Pencil size={14} strokeWidth={2} />
              </Button>
              <Button variant="ghost" size="icon-sm" ariaLabel="Delete model" onclick={() => (pendingDelete = model)}>
                <Trash2 size={14} strokeWidth={2} />
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<ModelDefinitionDialog bind:open={dialogOpen} model={editing} {providerItems} />

<ConfirmDialog
  open={!!pendingDelete}
  title="Delete model?"
  description={pendingDelete
    ? `This removes “${pendingDelete.name}” (${pendingDelete.modelId}) from the catalog.`
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

  .provider-item.orphan {
    border-color: color-mix(in oklab, var(--warning) 45%, transparent);
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

  .orphan-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--warning);
    font-size: var(--text-xs);
  }
</style>
