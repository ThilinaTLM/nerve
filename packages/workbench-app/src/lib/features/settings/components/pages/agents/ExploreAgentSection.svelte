<script lang="ts">
import { thinkingLevels } from "@nervekit/contracts";
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import {
  SettingsGroup,
  SettingsKeyValueRow,
} from "$lib/presentation/components/settings";
import {
  modelDisplayName,
  modelKey,
  providerDisplayName,
  usableModelOptions,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";
import ModelPickerRow from "./ModelPickerRow.svelte";

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
    policyLabel="Explore agent policy"
    onSave={saveExploreModel}
  >
    {#snippet summaryMeta()}
      {#if selectedModelInfo}
        {providerDisplayName(selectedModelInfo.provider)}
      {:else}
        Use the platform fallback model
      {/if}
    {/snippet}
    {#snippet policy()}
      <SettingsKeyValueRow label="Permission" value="Read only" />
      <SettingsKeyValueRow label="Mode" value="Coding" />
      <SettingsKeyValueRow label="Working directory" value="Same as parent" />
      <SettingsKeyValueRow label="Conversation history" value="Fresh" />
    {/snippet}
  </ModelPickerRow>
</SettingsGroup>
