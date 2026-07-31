<script lang="ts">
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { clampThinkingLevelForModel } from "$lib/features/conversations/state/agent-selection-defaults";
import {
  SettingsChoiceCards,
  SettingsGroup,
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
import type { SettingsChange } from "../settings-change";
import { modeItems, permissionItems } from "./agent-options";
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
const effectivePermissionLevel = $derived(
  settingsDraft.rememberLastAgentSelection
    ? settingsDraft.lastAgentSelection.permissionLevel
    : settingsDraft.defaultPermissionLevel,
);
const effectiveApprovalPolicy = $derived(
  settingsDraft.rememberLastAgentSelection
    ? settingsDraft.lastAgentSelection.approvalPolicy
    : settingsDraft.defaultApprovalPolicy,
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

function readPolicy(
  permission: Settings["defaultPermissionLevel"] | undefined,
): string {
  if (
    permission === "supervised" &&
    !effectiveApprovalPolicy.autoApproveReadOnly
  )
    return "Approval required";
  return "Allowed";
}

function writePolicy(
  permission: Settings["defaultPermissionLevel"] | undefined,
): string {
  if (permission === "read_only") return "Denied";
  if (permission === "supervised") return "Approval required";
  if (permission === "autonomous") return "Allowed";
  return "Policy-managed";
}

function commandPolicy(
  permission: Settings["defaultPermissionLevel"] | undefined,
): string {
  if (permission === "read_only") return "Denied";
  if (permission === "supervised") return "Approval required";
  if (permission === "autonomous") return "Allowed";
  return "Policy-managed";
}

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
    approvalPolicy: conversationState.selectedApprovalPolicy,
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

function setDefaultPermission(value: string): void {
  const next = value as Settings["defaultPermissionLevel"];
  settingsDraft.defaultPermissionLevel = next;
  onSettingsChange?.({ defaultPermissionLevel: next }, { immediate: true });
}

function setAutoApproveReadOnly(autoApproveReadOnly: boolean): void {
  settingsDraft.defaultApprovalPolicy.autoApproveReadOnly = autoApproveReadOnly;
  onSettingsChange?.(
    { defaultApprovalPolicy: { autoApproveReadOnly } },
    { immediate: true },
  );
}
</script>

<SettingsGroup>
  <SettingsRow label="Default mode" layout="stacked">
    <SettingsChoiceCards
      items={modeItems}
      value={settingsDraft.defaultMode}
      ariaLabel="Default mode"
      onValueChange={setDefaultMode}
    />
  </SettingsRow>

  <SettingsRow label="Default permission" layout="stacked">
    <SettingsChoiceCards
      items={permissionItems}
      value={settingsDraft.defaultPermissionLevel}
      ariaLabel="Default permission"
      onValueChange={setDefaultPermission}
    />
  </SettingsRow>

  <ModelPickerRow
    label="Default model"
    description="Choose the model and thinking level together."
    models={availableModels}
    selectedModel={settingsDraft.defaultModel}
    selectedThinkingLevel={defaultThinkingLevel}
    summaryTitle={rootModelTitle()}
    fallbackOption={{
      label: "First available scoped model",
      detail: "Use the first configured model allowed by Scoped Models",
    }}
    {fallbackThinkingLevels}
    dialogTitle="Choose default model"
    dialogDescription="Search available scoped models, choose one model, then select its thinking level."
    confirmLabel="Save default model"
    policyLabel="Default agent policy"
    onSave={saveDefaultModel}
  >
    {#snippet summaryMeta()}
      {#if savedDefaultModelInfo}
        {providerDisplayName(savedDefaultModelInfo.provider)} ·
        <span class="font-mono">{savedDefaultModelInfo.modelId}</span>
        · {defaultThinkingLevel}
      {:else if defaultModelInfo}
        Currently {modelDisplayName(defaultModelInfo)} · {defaultThinkingLevel}
      {:else}
        No scoped model available · {defaultThinkingLevel}
      {/if}
    {/snippet}
    {#snippet policy()}
      <PolicyRow
        label="File system read"
        value={readPolicy(effectivePermissionLevel)}
      />
      <PolicyRow
        label="File system write"
        value={writePolicy(effectivePermissionLevel)}
      />
      <PolicyRow
        label="Terminal commands"
        value={commandPolicy(effectivePermissionLevel)}
      />
      <PolicyRow label="Network access" value="Tool-dependent" />
    {/snippet}
  </ModelPickerRow>

  <SettingsToggleRow
    label="Auto-approve read-only tools in supervised mode"
    description="Let supervised agents read files, search, list directories, and inspect task status without prompting."
    checked={settingsDraft.defaultApprovalPolicy.autoApproveReadOnly}
    onCheckedChange={setAutoApproveReadOnly}
  />

  <SettingsToggleRow
    label="Use last selections for new agents"
    description="Reuse the last composer selections for new conversations."
    checked={settingsDraft.rememberLastAgentSelection}
    onCheckedChange={onRememberLastSelectionChange}
  />
</SettingsGroup>
