<script lang="ts">
import { clampThinkingLevelForModel } from "$lib/application/preferences/agent-selection";
import type {
  AgentRecord,
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
} from "$lib/api";
import {
  SettingsGroup,
  SettingsInlineMessage,
  SettingsSection,
  SettingsToggleRow,
} from "$lib/presentation/settings";
import {
  authenticatedRealModelOptions,
  modelKey,
} from "$lib/presentation/utils/model";
import type { SettingsChange } from "../settings-change";
import ScopedModelCatalog from "./ScopedModelCatalog.svelte";

type ThinkingLevel = AgentRecord["thinkingLevel"];

type Props = {
  settingsDraft: Settings;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
  /** Reads the composer's live selection; owned by app composition. */
  readComposerSelection?: () => Settings["lastAgentSelection"];
  onSettingsChange?: SettingsChange;
};

let {
  settingsDraft,
  models = [],
  authProviders = [],
  readComposerSelection,
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

/** Starring a model makes it the default new agents start with. */
function makeDefault(
  selection: ModelSelection,
  model: ModelInfo,
  level: ThinkingLevel,
): void {
  const thinkingLevel = clampThinkingLevelForModel(level, model);
  settingsDraft.defaultModel = selection;
  settingsDraft.defaultThinkingLevel = thinkingLevel;
  onSettingsChange?.(
    { defaultModel: selection, defaultThinkingLevel: thinkingLevel },
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

  const lastAgentSelection = readComposerSelection?.();
  if (!lastAgentSelection) {
    onSettingsChange?.(
      { rememberLastAgentSelection: true },
      { immediate: true },
    );
    return;
  }

  settingsDraft.lastAgentSelection = lastAgentSelection;
  onSettingsChange?.(
    {
      rememberLastAgentSelection: true,
      lastAgentSelection: {
        ...lastAgentSelection,
        model: lastAgentSelection.model ?? null,
      },
    },
    { immediate: true },
  );
}

function commitScopedModels(next: ModelSelection[]): void {
  settingsDraft.scopedModels = next;
  onSettingsChange?.({ scopedModels: next }, { immediate: true });
}
</script>

<SettingsSection id="models" title="Scoped models">
  <SettingsGroup>
    {#if availableModels.length === 0}
      <SettingsInlineMessage
        tone="info"
        text="Authenticate a provider before choosing scoped models."
      />
    {:else}
      <ScopedModelCatalog
        models={availableModels}
        scopedModels={settingsDraft.scopedModels}
        defaultModel={settingsDraft.defaultModel}
        defaultThinkingLevel={settingsDraft.defaultThinkingLevel}
        onScopedModelsChange={commitScopedModels}
        onMakeDefault={makeDefault}
      />
      {#if staleCount > 0}
        <SettingsInlineMessage
          tone="warning"
          text={`${staleCount} scoped ${staleCount === 1 ? "model is" : "models are"} no longer available and will be ignored by the picker. Uncheck to remove.`}
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
