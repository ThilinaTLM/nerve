<script lang="ts">
import Star from "@lucide/svelte/icons/star";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { clampThinkingLevelForModel } from "$lib/application/preferences/agent-selection";
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
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelDisplayName,
  modelKey,
  parseModelKey,
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

const defaultModelKey = $derived(
  settingsDraft.defaultModel ? modelKey(settingsDraft.defaultModel) : undefined,
);

/** Starring a model makes it the default new agents start with. */
function makeDefault(entry: ScopedEntry): void {
  const thinkingLevel = clampThinkingLevelForModel(
    settingsDraft.defaultThinkingLevel,
    entry.model,
  );
  settingsDraft.defaultModel = entry.selection;
  settingsDraft.defaultThinkingLevel = thinkingLevel;
  onSettingsChange?.(
    { defaultModel: entry.selection, defaultThinkingLevel: thinkingLevel },
    { immediate: true },
  );
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

<SettingsSection id="models" title="Scoped models">
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
          <SettingsListItem title={label}>
            {#snippet detail()}
              <span class="truncate"
                >({entry.selection.provider}/{entry.selection.modelId})</span
              >
            {/snippet}
            {#snippet status()}
              {#if entry.stale}
                <Badge variant="warning">Unavailable</Badge>
              {/if}
            {/snippet}
            {#snippet actions()}
              <IconAction
                icon={Star}
                active={isDefault}
                disabled={entry.stale}
                label={isDefault
                  ? `Default model for new agents`
                  : `Make ${label} the default model`}
                onclick={() => makeDefault(entry)}
              />
              <IconAction
                icon={Trash2}
                label={`Remove ${label} from the scope`}
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

    <SettingsToggleRow
      label="Remember last selected model as default"
      description="New agents reuse the model you last chose in the composer instead of the starred default."
      checked={settingsDraft.rememberLastAgentSelection}
      onCheckedChange={onRememberLastSelectionChange}
    />
  </SettingsGroup>
</SettingsSection>

<AddScopedModelsDialog
  bind:open={pageState.addDialogOpen}
  {models}
  {authProviders}
  scopedModels={settingsDraft.scopedModels}
  onSave={commitScopedModels}
/>
