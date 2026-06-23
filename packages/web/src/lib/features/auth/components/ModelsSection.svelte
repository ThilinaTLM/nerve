<script lang="ts">
  import Cpu from "@lucide/svelte/icons/cpu";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plus from "@lucide/svelte/icons/plus";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ModelDefinition, ModelInfo } from "$lib/api";
  import { deleteModelDefinition } from "$lib/api";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/ui/confirm-dialog";
  import { authState } from "$lib/features/auth/state/auth-state.svelte";
  import { refreshProviderCatalog } from "$lib/features/auth/state/auth.svelte";
  import ModelDefinitionDialog from "./ModelDefinitionDialog.svelte";

  type Props = {
    models?: ModelInfo[];
  };

  let { models = [] }: Props = $props();

  let dialogOpen = $state(false);
  let editing = $state<ModelDefinition | undefined>(undefined);
  let pendingDelete = $state<ModelDefinition | undefined>(undefined);

  // Built-in providers (those exposed by pi-ai), used as targets for manual models.
  const builtInProviders = $derived(
    [
      ...new Set(
        models
          .filter((model) => !model.faux)
          .map((model) => model.provider),
      ),
    ]
      .filter(
        (id) => !authState.customProviders.some((custom) => custom.id === id),
      )
      .sort(),
  );

  const customProviderIds = $derived(
    new Set(authState.customProviders.map((custom) => custom.id)),
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
        ?.displayName ?? id
    );
  }

  function isOrphan(model: ModelDefinition): boolean {
    // A model is unusable if it targets a missing custom provider without its
    // own api/baseUrl connection settings.
    if (model.api && model.baseUrl) return false;
    return !customProviderIds.has(model.provider);
  }

  function openAdd() {
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

<section id="auth-models" class="settings-section" data-section="models">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Cpu size={14} strokeWidth={2.1} /> Models</div>
    <h2>Manual models</h2>
    <p>Register models by hand for custom or built-in providers. They appear in the composer model picker once authenticated.</p>
  </header>

  <div class="settings-section-body">
    <div class="settings-row providers-summary">
      <div class="settings-copy">
        <strong>{definitions.length === 0 ? "No manual models" : `${definitions.length} added`}</strong>
        <span>Add a model with its id, context window, and thinking capability.</span>
      </div>
      <Button size="sm" onclick={openAdd}>
        <Plus size={15} strokeWidth={2.2} />
        Add model
      </Button>
    </div>

    {#if definitions.length === 0}
      <p class="settings-note">Add a model to expose it in the composer picker.</p>
    {:else}
      <ul class="provider-list">
        {#each definitions as model (`${model.provider}:${model.modelId}`)}
          <li class="provider-item" class:orphan={isOrphan(model)}>
            <div class="provider-item-text">
              <strong>{model.name}</strong>
              <span>{providerLabel(model.provider)} · {model.modelId}</span>
            </div>
            <div class="provider-item-actions">
              {#if isOrphan(model)}
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

<ModelDefinitionDialog bind:open={dialogOpen} model={editing} {builtInProviders} />

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
