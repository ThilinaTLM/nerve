<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsListItem,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
  providerDisplayName,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";
import AddScopedModelsDialog from "./AddScopedModelsDialog.svelte";
import type { ModelsPageState } from "./models-page-state.svelte";

type ScopedEntry = {
  key: string;
  selection: ModelSelection;
  model?: ModelInfo;
  stale: boolean;
};

type Props = {
  pageState: ModelsPageState;
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  pageState,
  settingsDraft,
  models = [],
  authProviders = [],
  onSettingsChange,
}: Props = $props();

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
      const provider = providerDisplayName(
        left.selection.provider,
      ).localeCompare(providerDisplayName(right.selection.provider));
      const leftLabel = left.model
        ? modelDisplayName(left.model)
        : left.selection.modelId;
      const rightLabel = right.model
        ? modelDisplayName(right.model)
        : right.selection.modelId;
      return provider || leftLabel.localeCompare(rightLabel);
    }),
);
const staleCount = $derived(
  scopedEntries.filter((entry) => entry.stale).length,
);

function commitScopedModels(next: ModelSelection[]): void {
  settingsDraft.scopedModels = next;
  onSettingsChange?.({ scopedModels: next }, { immediate: true });
}

function removeEntry(key: string): void {
  commitScopedModels(
    settingsDraft.scopedModels.filter(
      (selection) => modelKey(selection) !== key,
    ),
  );
}
</script>

<SettingsGroup>
  {#if availableModels.length === 0}
    <SettingsInlineMessage
      tone="info"
      text="Authenticate a provider before choosing scoped models."
    />
  {:else if !scopeActive}
    <SettingsEmptyState
      title="No scope set"
      description="Scoped models limit which models the composer offers. Every authenticated model appears until you add one."
    >
      {#snippet actions()}
        <Button
          size="xs"
          data-tour-id="setup-scoped-models-add"
          onclick={() => (pageState.addDialogOpen = true)}>Add models</Button
        >
      {/snippet}
    </SettingsEmptyState>
  {:else}
    <SettingsList ariaLabel="Scoped models" divided={false} gap="sm">
      {#each scopedEntries as entry (entry.key)}
        {@const label = entry.model
          ? modelDisplayName(entry.model)
          : entry.selection.modelId}
        <SettingsListItem variant="card" title={label}>
          {#snippet meta()}
            <span class="truncate">
              {providerDisplayName(entry.selection.provider)} ·
              <span class="font-mono">{entry.selection.modelId}</span>
              {#if entry.stale}
                · <span class="text-warning">Unavailable</span>
              {/if}
            </span>
          {/snippet}
          {#snippet actions()}
            <Button
              variant="ghost"
              size="xs"
              onclick={() => removeEntry(entry.key)}>Remove</Button
            >
          {/snippet}
        </SettingsListItem>
      {/each}
    </SettingsList>

    {#if staleCount > 0}
      <SettingsInlineMessage
        tone="warning"
        text={`${staleCount} scoped ${staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by the picker.`}
      />
    {/if}
  {/if}
</SettingsGroup>

<AddScopedModelsDialog
  bind:open={pageState.addDialogOpen}
  {models}
  {authProviders}
  scopedModels={settingsDraft.scopedModels}
  onSave={commitScopedModels}
/>
