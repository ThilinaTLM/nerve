<script lang="ts">
import { thinkingLevels } from "@nervekit/contracts";
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import { SettingsGroup } from "$lib/presentation/components/settings";
import {
  modelDisplayName,
  modelKey,
  providerDisplayName,
  usableModelOptions,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";
import ModelPickerRow from "./ModelPickerRow.svelte";
import PolicyRow from "./PolicyRow.svelte";

type Props = {
  settingsDraft: Settings;
  models: ModelInfo[];
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  models = [],
  authProviders = [],
  onSettingsChange,
}: Props = $props();

const availableModels = $derived(usableModelOptions(models, authProviders));

const selectedModelInfo = $derived(
  settingsDraft.exploreAgent.model
    ? availableModels.find(
        (model) =>
          modelKey(model) ===
          modelKey(settingsDraft.exploreAgent.model as ModelSelection),
      )
    : undefined,
);

function saveExploreModel(selection: {
  model?: Settings["exploreAgent"]["model"];
  thinkingLevel: Settings["exploreAgent"]["thinkingLevel"];
}): void {
  settingsDraft.exploreAgent = {
    ...settingsDraft.exploreAgent,
    model: selection.model,
    thinkingLevel: selection.thinkingLevel,
  };
  onSettingsChange?.(
    {
      exploreAgent: {
        model: selection.model ?? null,
        thinkingLevel: selection.thinkingLevel,
      },
    },
    { immediate: true },
  );
}
</script>

<SettingsGroup>
  <ModelPickerRow
    label="Explore model"
    tourId="setup-agent-explore-model"
    description="Choose the model and thinking level together."
    models={availableModels}
    selectedModel={settingsDraft.exploreAgent.model}
    selectedThinkingLevel={settingsDraft.exploreAgent.thinkingLevel}
    summaryTitle={selectedModelInfo
      ? modelDisplayName(selectedModelInfo)
      : "Default model"}
    fallbackOption={{
      label: "Default model",
      detail: "Use the platform fallback model",
      actionLabel: "Use default model",
    }}
    fallbackThinkingLevels={[...thinkingLevels]}
    dialogTitle="Choose explore model"
    dialogDescription="Search available models, choose one model, then select its thinking level."
    confirmLabel="Save explore model"
    policyLabel="Explore agent policy"
    onSave={saveExploreModel}
  >
    {#snippet summaryMeta()}
      {#if selectedModelInfo}
        {providerDisplayName(selectedModelInfo.provider)} ·
        <span class="font-mono">{selectedModelInfo.modelId}</span>
        · {settingsDraft.exploreAgent.thinkingLevel}
      {:else}
        Use the platform fallback model · {settingsDraft.exploreAgent
          .thinkingLevel}
      {/if}
    {/snippet}
    {#snippet policy()}
      <PolicyRow label="Permission" value="Read only" />
      <PolicyRow label="Mode" value="Coding" />
      <PolicyRow label="Working directory" value="Same as parent" />
      <PolicyRow label="Conversation history" value="Fresh" />
    {/snippet}
  </ModelPickerRow>
</SettingsGroup>
