<!--
  Model scope: which models pickers offer. An empty scope offers every
  authenticated model. The default model and its reasoning level are set in
  Agent → General.
-->
<script lang="ts">
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import ModelMultiSelect from "$lib/presentation/model-picker/ModelMultiSelect.svelte";
import {
  SettingsInlineMessage,
  SettingsSection,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelKey,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";

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

const availableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const staleCount = $derived.by(() => {
  const available = new Set(availableModels.map(modelKey));
  return settingsDraft.scopedModels.filter(
    (selection) => !available.has(modelKey(selection)),
  ).length;
});

function commitScopedModels(next: ModelSelection[]): void {
  settingsDraft.scopedModels = next;
  onSettingsChange?.({ scopedModels: next }, { immediate: true });
}
</script>

<SettingsInlineMessage
  tone="neutral"
  text="An empty scope offers every authenticated model. The default model and reasoning level are set in Agent → General."
/>

<SettingsSection id="models" title="Model scope">
  {#if availableModels.length === 0}
    <SettingsInlineMessage
      tone="info"
      text="Authenticate a provider before choosing scoped models."
    />
  {:else}
    <ModelMultiSelect
      models={availableModels}
      scopedModels={settingsDraft.scopedModels}
      onScopedModelsChange={commitScopedModels}
    />
    {#if staleCount > 0}
      <SettingsInlineMessage
        tone="warning"
        text={`${staleCount} scoped ${staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by pickers. Uncheck to remove.`}
      />
    {/if}
  {/if}
</SettingsSection>
