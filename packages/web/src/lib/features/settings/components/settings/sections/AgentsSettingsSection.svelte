<script lang="ts">
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";

  import type {
    AuthProviderMetadata,
    ModelInfo,
    Settings,
    UpdateSettingsRequest,
  } from "$lib/api";
  import Info from "@lucide/svelte/icons/info";
  import RadioGroup from "@nervekit/shared-ui/components/ui/radio-group-field";
  import Switch from "@nervekit/shared-ui/components/ui/switch-field";
  import * as Tooltip from "@nervekit/shared-ui/components/ui/tooltip";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import { clampThinkingLevelForModel } from "$lib/features/conversations/state/agent-selection-defaults";
  import { SettingsSectionCard } from "@nervekit/shared-ui/components/settings";
  import SingleModelSelectionDialog from "./SingleModelSelectionDialog.svelte";
  import {
    modelDisplayName,
    modelKey,
    parseModelKey,
    providerDisplayName,
    scopedUsableModelOptions,
  } from "@nervekit/shared-ui/core/utils/model";
  import { modeItems, permissionItems } from "../options";

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

  const availableModels = $derived(
    scopedUsableModelOptions(models, authProviders, settingsDraft.scopedModels),
  );
  const savedDefaultModelInfo = $derived.by(() => {
    const defaultModel = settingsDraft.defaultModel;
    return defaultModel
      ? availableModels.find((model) => modelKey(model) === modelKey(defaultModel))
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
  let modelDialogOpen = $state(false);

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

  function readPolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (
      permission === "supervised" &&
      !effectiveApprovalPolicy.autoApproveReadOnly
    ) return "Approval required";
    return "Allowed";
  }

  function writePolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (permission === "read_only") return "Denied";
    if (permission === "supervised") return "Approval required";
    if (permission === "autonomous") return "Allowed";
    return "Policy-managed";
  }

  function commandPolicy(permission: Settings["defaultPermissionLevel"] | undefined): string {
    if (permission === "read_only") return "Denied";
    if (permission === "supervised") return "Approval required";
    if (permission === "autonomous") return "Allowed";
    return "Policy-managed";
  }

  function saveDefaultModel(selection: {
    model?: Settings["defaultModel"];
    thinkingLevel: Settings["defaultThinkingLevel"];
  }) {
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

  function rootModelMeta(): string {
    const thinking = defaultThinkingLevel;
    if (savedDefaultModelInfo) {
      return `${providerDisplayName(savedDefaultModelInfo.provider)} · ${savedDefaultModelInfo.modelId} · ${thinking}`;
    }
    if (defaultModelInfo) {
      return `Currently ${modelDisplayName(defaultModelInfo)} · ${thinking}`;
    }
    return `No scoped model available · ${thinking}`;
  }

  function onAutoCompactionChange(checked: boolean) {
    settingsDraft.compaction.auto = checked;
    onSettingsChange?.({ compaction: { auto: checked } }, { immediate: true });
  }

  function onRememberLastSelectionChange(checked: boolean) {
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
</script>

<SettingsSectionCard section="agents" title="Default agent">
    <Switch
      class="settings-full-switch"
      checked={settingsDraft.rememberLastAgentSelection}
      label="Use last selections for new agents"
      description="Reuse the last composer selections for new conversations."
      onCheckedChange={onRememberLastSelectionChange}
    />

    <Switch
      class="settings-full-switch"
      checked={settingsDraft.compaction.auto}
      label="Auto-compact long conversations"
      description="Summarize older context as the model approaches its context window."
      onCheckedChange={onAutoCompactionChange}
    />

    <Switch
      class="settings-full-switch"
      checked={settingsDraft.defaultApprovalPolicy.autoApproveReadOnly}
      label="Auto-approve read-only tools in supervised mode"
      description="Let supervised agents read files, search, list directories, and inspect task status without prompting."
      onCheckedChange={(autoApproveReadOnly) => {
        settingsDraft.defaultApprovalPolicy.autoApproveReadOnly = autoApproveReadOnly;
        onSettingsChange?.(
          { defaultApprovalPolicy: { autoApproveReadOnly } },
          { immediate: true },
        );
      }}
    />

    <div class="settings-control-stack">
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Default mode</strong>
        </div>
        <RadioGroup
          class="settings-radio-two"
          items={modeItems}
          value={settingsDraft.defaultMode}
          orientation="horizontal"
          ariaLabel="Default mode"
          onValueChange={(value) => {
            const next = value as Settings["defaultMode"];
            settingsDraft.defaultMode = next;
            onSettingsChange?.({ defaultMode: next }, { immediate: true });
          }}
        />
      </div>

      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Default permission</strong>
        </div>
        <RadioGroup
          class="settings-radio-three"
          items={permissionItems}
          value={settingsDraft.defaultPermissionLevel}
          orientation="horizontal"
          ariaLabel="Default permission"
          onValueChange={(value) => {
            const next = value as Settings["defaultPermissionLevel"];
            settingsDraft.defaultPermissionLevel = next;
            onSettingsChange?.({ defaultPermissionLevel: next }, { immediate: true });
          }}
        />
      </div>
    </div>

    <div class="settings-model-summary">
      <div class="settings-copy">
        <strong>Default model</strong>
        <span>Choose the model and thinking level together.</span>
      </div>
      <div class="settings-model-summary-main">
        <span class="settings-model-summary-text">
          <strong>{rootModelTitle()}</strong>
          <span>{rootModelMeta()}</span>
        </span>
        <span class="settings-model-actions">
          <Tooltip.Provider delayDuration={200}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <button
                    type="button"
                    class="settings-info-trigger"
                    aria-label="Default agent policy"
                    {...props}
                  >
                    <Info size={14} strokeWidth={2.1} />
                  </button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="top" class="settings-policy-tooltip">
                <div class="settings-policy-tooltip-row"><span>File system read</span><strong>{readPolicy(effectivePermissionLevel)}</strong></div>
                <div class="settings-policy-tooltip-row"><span>File system write</span><strong>{writePolicy(effectivePermissionLevel)}</strong></div>
                <div class="settings-policy-tooltip-row"><span>Terminal commands</span><strong>{commandPolicy(effectivePermissionLevel)}</strong></div>
                <div class="settings-policy-tooltip-row"><span>Network access</span><strong>Tool-dependent</strong></div>
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
          <Button size="sm" variant="outline" onclick={() => (modelDialogOpen = true)}>Change model</Button>
        </span>
      </div>
    </div>
</SettingsSectionCard>

<SingleModelSelectionDialog
  bind:open={modelDialogOpen}
  title="Choose default model"
  description="Search available scoped models, choose one model, then select its thinking level."
  models={availableModels}
  selectedModel={settingsDraft.defaultModel}
  selectedThinkingLevel={defaultThinkingLevel}
  fallbackOption={{
    label: "First available scoped model",
    detail: "Use the first configured model allowed by Scoped Models",
  }}
  fallbackThinkingLevels={fallbackThinkingLevels}
  confirmLabel="Save default model"
  onSave={saveDefaultModel}
/>