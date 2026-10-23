<!--
  Model scope: which models pickers offer. An empty scope offers every
  authenticated model. The default model and its reasoning level are set in
  Agent → General.
-->
<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "$lib/api";
import ModelMultiSelect from "$lib/presentation/model-picker/ModelMultiSelect.svelte";
import {
  SettingsInlineMessage,
  SettingsSection,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelKey,
} from "$lib/presentation/utils/model";
import { CreationPreferencesState } from "../../../state/creation-preferences.svelte";

type Props = {
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
};
let { models = [], authProviders = [] }: Props = $props();

const preferences = new CreationPreferencesState();
$effect(() => {
  void preferences.load({ scope: "user" });
});
$effect(() => preferences.observe());
const available = $derived(
  preferences.result?.status === "available" ? preferences.result : undefined,
);
const scopedModels = $derived(available?.effective.scopedModels ?? []);
const availableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const staleCount = $derived.by(() => {
  const available = new Set(availableModels.map(modelKey));
  return scopedModels.filter((selection) => !available.has(modelKey(selection)))
    .length;
});

function commitScopedModels(next: ModelSelection[]): void {
  void preferences.save({ scopedModels: next });
}
</script>

<SettingsInlineMessage
  tone="neutral"
  text="An empty scope offers every authenticated model. Choose a model and reasoning level in the conversation."
/>

<SettingsSection id="models" title="Model scope">
  {#if availableModels.length === 0}
    <SettingsInlineMessage
      tone="info"
      text="Authenticate a provider before choosing scoped models."
    />
  {:else if available && !preferences.saving}
    <ModelMultiSelect
      models={availableModels}
      {scopedModels}
      onScopedModelsChange={commitScopedModels}
    />
    {#if available.overrides.scopedModels !== undefined}
      <Button
        variant="ghost"
        disabled={preferences.saving}
        onclick={() => preferences.save({}, ["/overrides/scopedModels"])}
        >Reset model scope</Button
      >
    {/if}
    {#if staleCount > 0}
      <SettingsInlineMessage
        tone="warning"
        text={`${staleCount} scoped ${staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by pickers. Uncheck to remove.`}
      />
    {/if}
  {/if}
</SettingsSection>

{#if preferences.error}<SettingsInlineMessage
    tone="destructive"
    text={preferences.error}
  />{/if}
