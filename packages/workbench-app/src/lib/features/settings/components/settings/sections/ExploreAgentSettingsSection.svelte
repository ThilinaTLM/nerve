<script lang="ts">
import Info from "@lucide/svelte/icons/info";
import { thinkingLevels } from "@nervekit/contracts";
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
  UpdateSettingsRequest,
} from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { SettingsSectionCard } from "@nervekit/workbench-ui/components/settings";
import SingleModelSelectionDialog from "./SingleModelSelectionDialog.svelte";
import {
  modelDisplayName,
  modelKey,
  providerDisplayName,
  usableModelOptions,
} from "@nervekit/workbench-ui/core/utils/model";

type SettingsChange = (
  patch: UpdateSettingsRequest,
  options?: { immediate?: boolean; debounceMs?: number },
) => void;

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
let modelDialogOpen = $state(false);

const selectedModelInfo = $derived(
  settingsDraft.exploreAgent.model
    ? availableModels.find(
        (model) =>
          modelKey(model) ===
          modelKey(settingsDraft.exploreAgent.model as ModelSelection),
      )
    : undefined,
);
const fallbackThinkingLevels = thinkingLevels;

function saveExploreModel(selection: {
  model?: Settings["exploreAgent"]["model"];
  thinkingLevel: Settings["exploreAgent"]["thinkingLevel"];
}) {
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

function exploreModelTitle(): string {
  if (selectedModelInfo) return modelDisplayName(selectedModelInfo);
  return "Default model";
}

function exploreModelMeta(): string {
  const thinking = settingsDraft.exploreAgent.thinkingLevel;
  if (selectedModelInfo) {
    return `${providerDisplayName(selectedModelInfo.provider)} · ${selectedModelInfo.modelId} · ${thinking}`;
  }
  return `Use the platform fallback model · ${thinking}`;
}
</script>

<SettingsSectionCard section="explore" title="Explore agent">
  <div class="settings-model-summary">
    <div class="settings-copy">
      <strong>Explore model</strong>
      <span>Choose the model and thinking level together.</span>
    </div>
    <div class="settings-model-summary-main">
      <span class="settings-model-summary-text">
        <strong>{exploreModelTitle()}</strong>
        <span>{exploreModelMeta()}</span>
      </span>
      <span class="settings-model-actions">
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <button
                  type="button"
                  class="settings-info-trigger"
                  aria-label="Explore agent policy"
                  {...props}
                >
                  <Info size={14} strokeWidth={2.1} />
                </button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top" class="settings-policy-tooltip">
              <div class="settings-policy-tooltip-row">
                <span>Permission</span><strong>Read only</strong>
              </div>
              <div class="settings-policy-tooltip-row">
                <span>Mode</span><strong>Coding</strong>
              </div>
              <div class="settings-policy-tooltip-row">
                <span>Working directory</span><strong>Same as parent</strong>
              </div>
              <div class="settings-policy-tooltip-row">
                <span>Conversation history</span><strong>Fresh</strong>
              </div>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
        <Button
          size="sm"
          variant="outline"
          onclick={() => (modelDialogOpen = true)}>Change model</Button
        >
      </span>
    </div>
  </div>
</SettingsSectionCard>

<SingleModelSelectionDialog
  bind:open={modelDialogOpen}
  title="Choose explore model"
  description="Search available models, choose one model, then select its thinking level."
  models={availableModels}
  selectedModel={settingsDraft.exploreAgent.model}
  selectedThinkingLevel={settingsDraft.exploreAgent.thinkingLevel}
  fallbackOption={{
    label: "Default model",
    detail: "Use the platform fallback model",
  }}
  fallbackThinkingLevels={[...fallbackThinkingLevels]}
  confirmLabel="Save explore model"
  onSave={saveExploreModel}
/>
