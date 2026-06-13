<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    ModelSelection,
    Settings,
    UpdateSettingsRequest,
  } from "$lib/api";
  import {
    authenticatedRealModelOptions,
    modelDisplayName,
    modelKey,
  } from "$lib/utils/model";

  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type ModelGroup = {
    provider: string;
    models: ModelInfo[];
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

  function modelSelection(model: ModelInfo): ModelSelection {
    return { provider: model.provider, modelId: model.modelId };
  }

  function groupModels(modelList: ModelInfo[]): ModelGroup[] {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of [...modelList].sort((left, right) => {
      const provider = left.provider.localeCompare(right.provider);
      return provider || left.label.localeCompare(right.label);
    })) {
      groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
    }
    return [...groups.entries()].map(([provider, groupModels]) => ({
      provider,
      models: groupModels,
    }));
  }

  function commitScopedModels(scopedModels: ModelSelection[]) {
    settingsDraft.scopedModels = scopedModels;
    onSettingsChange?.({ scopedModels }, { immediate: true });
  }

  function toggleModel(model: ModelInfo) {
    const key = modelKey(model);
    if (!scopeActive) {
      const next = availableModels
        .filter((candidate) => modelKey(candidate) !== key)
        .map(modelSelection);
      commitScopedModels(next.length === 0 ? [] : next);
      return;
    }

    const next = scopedKeys.has(key)
      ? settingsDraft.scopedModels.filter(
          (candidate) => modelKey(candidate) !== key,
        )
      : [...settingsDraft.scopedModels, modelSelection(model)];
    commitScopedModels(next.length === 0 ? [] : next);
  }

  function resetScope() {
    commitScopedModels([]);
  }

  const availableModels = $derived(
    authenticatedRealModelOptions(models, authProviders),
  );
  const scopeActive = $derived(settingsDraft.scopedModels.length > 0);
  const scopedKeys = $derived(
    new Set(settingsDraft.scopedModels.map((model) => modelKey(model))),
  );
  const selectedCount = $derived(
    scopeActive
      ? availableModels.filter((model) => scopedKeys.has(modelKey(model))).length
      : availableModels.length,
  );
  const staleCount = $derived(
    settingsDraft.scopedModels.filter(
      (selection) =>
        !availableModels.some((model) => modelKey(model) === modelKey(selection)),
    ).length,
  );
  const groupedModels = $derived(groupModels(availableModels));
  const summary = $derived(
    scopeActive
      ? `Showing ${selectedCount} of ${availableModels.length} authenticated models in the composer.`
      : "All authenticated models are shown in the composer.",
  );
</script>

<section id="settings-models" class="settings-section" data-section="models">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><SlidersHorizontal size={14} strokeWidth={2.1} /> Scoped Models</div>
    <h2>Composer model scope</h2>
    <p>Keep the model picker focused on the authenticated models you regularly use.</p>
  </header>

  <div class="settings-section-body">
    <div class="settings-row scoped-models-summary">
      <div class="settings-copy">
        <strong>{scopeActive ? "Scoped picker" : "All models"}</strong>
        <span>{summary}</span>
      </div>
      <button type="button" class="scope-reset-button" disabled={!scopeActive} onclick={resetScope}>
        Use all authenticated models
      </button>
    </div>

    {#if availableModels.length === 0}
      <p class="settings-note">Authenticate a provider before choosing scoped models.</p>
    {:else}
      <div class="scoped-models-list" role="group" aria-label="Scoped models">
        {#each groupedModels as group (group.provider)}
          <section class="scoped-models-provider" aria-label={group.provider}>
            <h3>{group.provider}</h3>
            <div class="scoped-models-provider-list">
              {#each group.models as model (modelKey(model))}
                {@const selected = !scopeActive || scopedKeys.has(modelKey(model))}
                <button
                  type="button"
                  class="scoped-model-row"
                  class:selected
                  role="checkbox"
                  aria-checked={selected}
                  onclick={() => toggleModel(model)}
                >
                  <span class="scoped-model-row-text">
                    <strong>{modelDisplayName(model)}</strong>
                    <span>{model.modelId}</span>
                  </span>
                  <span class="scoped-model-check" aria-hidden="true">
                    {#if selected}<Check size={14} strokeWidth={2.4} />{/if}
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
      {#if scopeActive && staleCount > 0}
        <p class="settings-note">
          {staleCount} scoped {staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by the picker.
        </p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .scoped-models-summary {
    align-items: flex-start;
  }

  .scope-reset-button {
    flex: none;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--foreground);
    padding: 0.42rem 0.7rem;
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
  }

  .scope-reset-button:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent) 50%, transparent);
  }

  .scope-reset-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .scoped-models-list {
    display: grid;
    max-height: min(42vh, 24rem);
    overflow: auto;
    border: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
    border-radius: var(--radius-sm);
    background: transparent;
  }

  .scoped-models-provider {
    display: grid;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 45%, transparent);
  }

  .scoped-models-provider:last-child {
    border-bottom: 0;
  }

  .scoped-models-provider h3 {
    margin: 0;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 38%, transparent);
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    padding: 0.52rem 0.65rem;
  }

  .scoped-models-provider-list {
    display: grid;
  }

  .scoped-model-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    width: 100%;
    border: 0;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
    background: transparent;
    color: var(--foreground);
    padding: 0.58rem 0.65rem;
    text-align: left;
    cursor: pointer;
  }

  .scoped-model-row:last-child {
    border-bottom: 0;
  }

  .scoped-model-row:hover {
    background: color-mix(in oklab, var(--accent) 50%, transparent);
  }

  .scoped-model-row.selected {
    background: color-mix(in oklab, var(--accent) 35%, transparent);
  }

  .scoped-model-row-text {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .scoped-model-row-text strong,
  .scoped-model-row-text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scoped-model-row-text strong {
    color: var(--foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .scoped-model-row-text span {
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .scoped-model-check {
    display: grid;
    flex: none;
    place-items: center;
    width: 1rem;
    color: var(--primary);
  }
</style>
