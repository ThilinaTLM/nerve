<script lang="ts">
import Star from "@lucide/svelte/icons/star";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { clampThinkingLevelForModel } from "$lib/application/preferences/agent-selection";
import { permissionRuleSetDisplayName } from "$lib/domain/permissions/rule-set-options";
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
  SettingsKeyValueRow,
  SettingsList,
  SettingsListItem,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
  parseModelKey,
  providerDisplayName,
  scopedUsableModelOptions,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";
import ModelPickerRow from "../../shared/ModelPickerRow.svelte";
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

const defaultModelCandidates = $derived(
  scopedUsableModelOptions(models, authProviders, settingsDraft.scopedModels),
);
const savedDefaultModelInfo = $derived.by(() => {
  const selection = settingsDraft.defaultModel;
  return selection
    ? defaultModelCandidates.find(
        (model) => modelKey(model) === modelKey(selection),
      )
    : undefined;
});
const defaultModelInfo = $derived(
  savedDefaultModelInfo ?? defaultModelCandidates[0],
);
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
const defaultModelKey = $derived(
  settingsDraft.defaultModel ? modelKey(settingsDraft.defaultModel) : undefined,
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

function makeDefault(entry: ScopedEntry): void {
  saveDefaultModel({
    model: entry.selection,
    thinkingLevel: clampThinkingLevelForModel(
      settingsDraft.defaultThinkingLevel,
      entry.model,
    ),
  });
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
      lastAgentSelection: { ...lastAgentSelection, model: model ?? null },
    },
    { immediate: true },
  );
}

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

<SettingsSection
  id="default-model"
  title="Default model"
  description="New agents start with this model unless they reuse your last composer selections."
>
  <SettingsGroup>
    <ModelPickerRow
      label="Default model"
      tourId="setup-agent-default-model"
      description="Choose the model and thinking level together."
      models={defaultModelCandidates}
      selectedModel={settingsDraft.defaultModel}
      selectedThinkingLevel={defaultThinkingLevel}
      summaryTitle={savedDefaultModelInfo
        ? modelDisplayName(savedDefaultModelInfo)
        : "First available model"}
      fallbackOption={{
        label: "First available model",
        detail: "Use the first model allowed by the scope below",
        actionLabel: "Use first available",
      }}
      {fallbackThinkingLevels}
      dialogTitle="Choose default model"
      dialogDescription="Search available models, choose one model, then select its thinking level."
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
          No model available
        {/if}
      {/snippet}
      {#snippet policy()}
        <SettingsKeyValueRow
          label="Permission rule set"
          value={permissionRuleSetDisplayName(effectivePermissionRuleSetId)}
        />
        <SettingsKeyValueRow label="Mode" value="Coding" />
      {/snippet}
    </ModelPickerRow>

    <SettingsToggleRow
      label="Use last selections for new agents"
      description="Reuse the last composer selections instead of the default model."
      checked={settingsDraft.rememberLastAgentSelection}
      onCheckedChange={onRememberLastSelectionChange}
    />
  </SettingsGroup>
</SettingsSection>

<SettingsSection
  id="scoped-models"
  title="Scoped models"
  description="Scoped models limit which models the composer offers. Every authenticated model appears until you add one."
>
  <SettingsGroup>
    {#if availableModels.length === 0}
      <SettingsInlineMessage
        tone="info"
        text="Authenticate a provider before choosing scoped models."
      />
    {:else if !scopeActive}
      <SettingsEmptyState
        variant="card"
        title="No scope set"
        description="Add models to limit what the composer offers."
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
      <SettingsList ariaLabel="Scoped models">
        {#each scopedEntries as entry (entry.key)}
          {@const label = entry.model
            ? modelDisplayName(entry.model)
            : entry.selection.modelId}
          {@const isDefault = entry.key === defaultModelKey}
          <SettingsListItem title={label} description={entry.selection.modelId}>
            {#snippet status()}
              {#if isDefault}
                <Badge variant="accent">Default</Badge>
              {/if}
              {#if entry.stale}
                <Badge variant="warning">Unavailable</Badge>
              {/if}
            {/snippet}
            {#snippet meta()}
              <span class="truncate"
                >{providerDisplayName(entry.selection.provider)}</span
              >
            {/snippet}
            {#snippet actions()}
              {#if !isDefault && !entry.stale}
                <IconAction
                  icon={Star}
                  label="Set as default model"
                  onclick={() => makeDefault(entry)}
                />
              {/if}
              <IconAction
                icon={Trash2}
                label="Remove scoped model"
                tone="destructive"
                onclick={() => removeEntry(entry.key)}
              />
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
</SettingsSection>

<AddScopedModelsDialog
  bind:open={pageState.addDialogOpen}
  {models}
  {authProviders}
  scopedModels={settingsDraft.scopedModels}
  onSave={commitScopedModels}
/>
