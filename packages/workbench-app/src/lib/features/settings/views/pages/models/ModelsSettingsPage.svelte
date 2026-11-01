<!--
  Model scope: which models pickers offer. An empty scope offers every
  authenticated model. The default model and its reasoning level are set in
  Agent → General.
-->
<script lang="ts">
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { AuthProviderMetadata, ModelInfo, ModelSelection } from "$lib/api";
import ModelMultiSelect from "$lib/presentation/model-picker/ModelMultiSelect.svelte";
import { SettingsSection } from "$lib/presentation/settings";
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
const savedScope = $derived(available?.effective.scopedModels ?? []);
/** Choices made while a save is in flight; shown immediately and saved in
 * order, so several models can be checked in quick succession. */
let pending = $state<ModelSelection[]>();
let flushing = false;
const scopedModels = $derived(pending ?? savedScope);
const availableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const staleCount = $derived.by(() => {
  const available = new Set(availableModels.map(modelKey));
  return scopedModels.filter((selection) => !available.has(modelKey(selection)))
    .length;
});

async function commitScopedModels(next: ModelSelection[]): Promise<void> {
  pending = next;
  if (flushing) return;
  flushing = true;
  try {
    while (pending) {
      const target: ModelSelection[] = pending;
      await preferences.save({ scopedModels: target });
      if (preferences.error || pending === target) {
        pending = undefined;
        break;
      }
    }
  } finally {
    flushing = false;
  }
}
</script>

<SettingsSection id="models" title="Model scope">
  {#if availableModels.length === 0}
    <Callout
      layout="block"
      tone="info"
      text="Authenticate a provider before choosing scoped models."
    />
  {:else if available}
    <ModelMultiSelect
      models={availableModels}
      {scopedModels}
      onScopedModelsChange={commitScopedModels}
    />
    {#if preferences.overrides.scopedModels !== undefined}
      <Button
        variant="ghost"
        disabled={preferences.saving || !!pending}
        onclick={() => preferences.save({}, ["/overrides/scopedModels"])}
        >Reset model scope</Button
      >
    {/if}
    {#if staleCount > 0}
      <Callout
        layout="block"
        tone="warning"
        text={`${staleCount} scoped ${staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by pickers. Uncheck to remove.`}
      />
    {/if}
  {/if}
</SettingsSection>

{#if preferences.error}<Callout
    layout="block"
    tone="destructive"
    text={preferences.error}
  />{/if}

<p class="text-ui text-muted-foreground">
  An empty scope offers every authenticated model. Choose a model and reasoning
  level in the conversation.
</p>
