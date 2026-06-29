<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    ModelSelection,
    Settings,
    UpdateSettingsRequest,
  } from "$lib/api";
  import { Button } from "$lib/components/ui/button";
  import {
    authenticatedRealModelOptions,
    modelDisplayName,
    modelKey,
    providerDisplayName,
  } from "$lib/core/utils/model";
  import AddScopedModelsDialog from "./AddScopedModelsDialog.svelte";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type ScopedEntry = {
    key: string;
    selection: ModelSelection;
    model?: ModelInfo;
    stale: boolean;
  };

  type Props = {
    settingsDraft: Settings;
    models?: ModelInfo[];
    authProviders?: AuthProviderMetadata[];
    onSettingsChange?: SettingsChange;
  };

  let {
    settingsDraft,
    models = [],
    authProviders = [],
    onSettingsChange,
  }: Props = $props();

  let dialogOpen = $state(false);

  const availableModels = $derived(
    authenticatedRealModelOptions(models, authProviders),
  );
  const availableByKey = $derived(
    new Map(availableModels.map((model) => [modelKey(model), model])),
  );
  const scopeActive = $derived(settingsDraft.scopedModels.length > 0);

  const scopedEntries = $derived.by<ScopedEntry[]>(() =>
    settingsDraft.scopedModels
      .map((selection) => {
        const key = modelKey(selection);
        const model = availableByKey.get(key);
        return { key, selection, model, stale: !model };
      })
      .sort((left, right) => {
        const provider = providerDisplayName(left.selection.provider).localeCompare(
          providerDisplayName(right.selection.provider),
        );
        const leftLabel = left.model
          ? modelDisplayName(left.model)
          : left.selection.modelId;
        const rightLabel = right.model
          ? modelDisplayName(right.model)
          : right.selection.modelId;
        return provider || leftLabel.localeCompare(rightLabel);
      }),
  );
  const staleCount = $derived(scopedEntries.filter((entry) => entry.stale).length);
  const activeCount = $derived(scopedEntries.length - staleCount);

  function commitScopedModels(next: ModelSelection[]) {
    settingsDraft.scopedModels = next;
    onSettingsChange?.({ scopedModels: next }, { immediate: true });
  }

  function removeEntry(key: string) {
    commitScopedModels(
      settingsDraft.scopedModels.filter((selection) => modelKey(selection) !== key),
    );
  }

  function clearScope() {
    commitScopedModels([]);
  }
</script>

<section id="settings-models" class="settings-section" data-section="models">
  <header class="settings-section-header">
    <h2>Scoped models</h2>
  </header>

  <div class="settings-section-body">
    <div class="settings-row scoped-models-summary">
      <div class="scoped-models-actions">
        {#if scopeActive}
          <Button variant="ghost" size="sm" onclick={clearScope}>Clear</Button>
        {/if}
        <Button size="sm" disabled={availableModels.length === 0} onclick={() => (dialogOpen = true)}>
          <Plus size={15} strokeWidth={2.2} />
          Add models
        </Button>
      </div>
    </div>

    {#if availableModels.length === 0}
      <p class="settings-note">Authenticate a provider before choosing scoped models.</p>
    {:else if !scopeActive}
      <div class="scoped-empty">
        <strong>No scope set</strong>
        <span>Every authenticated model appears in the composer picker. Add models to narrow it down.</span>
      </div>
    {:else}
      <ul class="scoped-list" aria-label="Scoped models">
        {#each scopedEntries as entry (entry.key)}
          <li class="scoped-list-item" class:stale={entry.stale}>
            <span class="scoped-list-text">
              <strong>{entry.model ? modelDisplayName(entry.model) : entry.selection.modelId}</strong>
              <span>{providerDisplayName(entry.selection.provider)} · {entry.selection.modelId}</span>
            </span>
            {#if entry.stale}
              <span class="scoped-list-stale">
                <TriangleAlert size={13} strokeWidth={2} />
                Unavailable
              </span>
            {/if}
            <button
              type="button"
              class="scoped-list-remove"
              aria-label={`Remove ${entry.model ? modelDisplayName(entry.model) : entry.selection.modelId}`}
              onclick={() => removeEntry(entry.key)}
            >
              <X size={14} strokeWidth={2.2} />
            </button>
          </li>
        {/each}
      </ul>
      {#if staleCount > 0}
        <p class="settings-note">
          {staleCount} scoped {staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by the picker.
        </p>
      {/if}
    {/if}
  </div>
</section>

<AddScopedModelsDialog
  bind:open={dialogOpen}
  {models}
  {authProviders}
  scopedModels={settingsDraft.scopedModels}
  onSave={commitScopedModels}
/>

<style>
  .scoped-models-summary {
    align-items: flex-start;
  }

  .scoped-models-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.4rem;
  }

  .scoped-empty {
    display: grid;
    gap: 0.18rem;
    border: 1px dashed color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    padding: 0.85rem 0.9rem;
  }

  .scoped-empty strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .scoped-empty span {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    line-height: 1.4;
  }

  .scoped-list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .scoped-list-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid color-mix(in oklab, var(--border) 50%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  }

  .scoped-list-item.stale {
    border-color: color-mix(in oklab, var(--warning) 45%, transparent);
  }

  .scoped-list-text {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 0.08rem;
  }

  .scoped-list-text strong {
    overflow: hidden;
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scoped-list-text span {
    overflow: hidden;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scoped-list-stale {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.3rem;
    color: var(--warning);
    font-size: var(--text-xs);
  }

  .scoped-list-remove {
    display: grid;
    flex: none;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 1px solid color-mix(in oklab, var(--border) 55%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
  }

  .scoped-list-remove:hover {
    border-color: color-mix(in oklab, var(--destructive) 50%, transparent);
    background: color-mix(in oklab, var(--destructive) 12%, transparent);
    color: var(--destructive);
  }
</style>
