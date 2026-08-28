<script lang="ts">
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { clampThinkingLevelForModel } from "$lib/application/preferences/agent-selection";
import {
  SettingsChoiceCards,
  SettingsGroup,
  SettingsKeyValueRow,
  SettingsRow,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import {
  modelDisplayName,
  modelKey,
  parseModelKey,
  providerDisplayName,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "$lib/features/settings/components/pages/settings-change";
import { modeItems } from "./agent-options";
import { permissionRuleSetDisplayName } from "$lib/kernel/permissions/permission-rule-set-options";
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

const availableModels = $derived(
  scopedUsableModelOptions(models, authProviders, settingsDraft.scopedModels),
);
const savedDefaultModelInfo = $derived.by(() => {
  const defaultModel = settingsDraft.defaultModel;
  return defaultModel
    ? availableModels.find(
        (model) => modelKey(model) === modelKey(defaultModel),
      )
    : undefined;
});
const defaultModelInfo = $derived(savedDefaultModelInfo ?? availableModels[0]);
const effectivePermissionRuleSetId = $derived(
  settingsDraft.rememberLastAgentSelection
    ? (settingsDraft.lastAgentSelection.permissionRuleSetId ??
        settingsDraft.lastAgentSelection.permissionLevel)
    : (settingsDraft.defaultPermissionRuleSetId ??
        settingsDraft.defaultPermissionLevel),
);
const fallbackThinkingLevels = $derived<Settings["defaultThinkingLevel"][]>(
  defaultModelInfo?.supportedThinkingLevels?.length
    ? defaultModelInfo.supportedThinkingLevels
    : ["off"],
);
const defaultThinkingLevel = $derived(
  clampThinkingLevelForModel(
    settingsDraft.defaultThinkingLevel,
    defaultModelInfo,
  ),
);

function saveDefaultModel(selection: {
  model?: Settings["defaultModel"];
  thinkingLevel: Settings["defaultThinkingLevel"];
}): void {
  settingsDraft.defaultModel = selection.model;
  settingsDraft.defaultThinkingLevel = selection.thinkingLevel;
  onSettingsChange?.(
    {
      defaultModel: selection.model ?? null,
      defaultThinkingLevel: selection.thinkingLevel,
    },
    { immediate: true },
  );
}

function rootModelTitle(): string {
  if (savedDefaultModelInfo) return modelDisplayName(savedDefaultModelInfo);
  return "First available scoped model";
}

function onRememberLastSelectionChange(checked: boolean): void {
  settingsDraft.rememberLastAgentSelection = checked;
  if (!checked) {
    onSettingsChange?.(
      { rememberLastAgentSelection: false },
      { immediate: true },
    );
    return;
  }

  const model = parseModelKey(conversationState.selectedModelKey);
  const lastAgentSelection = {
    mode: conversationState.selectedMode,
    permissionLevel: conversationState.selectedPermissionLevel,
    permissionRuleSetId: conversationState.selectedPermissionRuleSetId,
    ...(model ? { model } : {}),
    thinkingLevel: conversationState.selectedThinkingLevel,
  } satisfies Settings["lastAgentSelection"];
  settingsDraft.lastAgentSelection = lastAgentSelection;
  onSettingsChange?.(
    {
      rememberLastAgentSelection: true,
      lastAgentSelection: {
        ...lastAgentSelection,
        model: model ?? null,
      },
    },
    { immediate: true },
  );
}

function setDefaultMode(value: string): void {
  const next = value as Settings["defaultMode"];
  settingsDraft.defaultMode = next;
  onSettingsChange?.({ defaultMode: next }, { immediate: true });
}
</script>

<SettingsGroup>
  <SettingsRow label="Default mode" layout="stacked">
    <SettingsChoiceCards
      items={modeItems}
      variant="radio"
      value={settingsDraft.defaultMode}
      ariaLabel="Default mode"
      tourId="setup-agent-default-mode"
      onValueChange={setDefaultMode}
    />
  </SettingsRow>

  <ModelPickerRow
    label="Default model"
    tourId="setup-agent-default-model"
    description="Choose the model and thinking level together."
    models={availableModels}
    selectedModel={settingsDraft.defaultModel}
    selectedThinkingLevel={defaultThinkingLevel}
    summaryTitle={rootModelTitle()}
    fallbackOption={{
      label: "First available scoped model",
      detail: "Use the first configured model allowed by Scoped Models",
      actionLabel: "Use first available",
    }}
    {fallbackThinkingLevels}
    dialogTitle="Choose default model"
    dialogDescription="Search available scoped models, choose one model, then select its thinking level."
    policyLabel="Default agent policy"
    onSave={saveDefaultModel}
  >
    {#snippet summaryMeta()}
      {#if savedDefaultModelInfo}
        {providerDisplayName(savedDefaultModelInfo.provider)}
      {:else if defaultModelInfo}
        Currently {modelDisplayName(defaultModelInfo)} ·
        {providerDisplayName(defaultModelInfo.provider)}
      {:else}
        No scoped model available
      {/if}
    {/snippet}
    {#snippet policy()}
      <SettingsKeyValueRow
        label="Permission rule set"
        value={permissionRuleSetDisplayName(effectivePermissionRuleSetId)}
      />
      <SettingsKeyValueRow label="Planning mode" value="Planning rule set" />
    {/snippet}
  </ModelPickerRow>

  <SettingsToggleRow
    label="Use last selections for new agents"
    description="Reuse the last composer selections for new conversations."
    checked={settingsDraft.rememberLastAgentSelection}
    onCheckedChange={onRememberLastSelectionChange}
  />
</SettingsGroup>
