<script lang="ts">
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";

  import Bot from "@lucide/svelte/icons/bot";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    Settings,
    UpdateSettingsRequest,
  } from "$lib/api";
  import RadioGroup from "$lib/components/ui/radio-group-field";
  import SelectField, { type SelectItem } from "$lib/components/ui/select-field";
  import Switch from "$lib/components/ui/switch-field";
  import { clampThinkingLevelForModel } from "$lib/features/settings/state/agent-selection-defaults";
  import {
    contextualModelLabel,
    modelKey,
    parseModelKey,
    providerDisplayName,
    scopedUsableModelOptions,
  } from "$lib/core/utils/model";
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
  const defaultModelKey = $derived(
    savedDefaultModelInfo ? modelKey(savedDefaultModelInfo) : "auto",
  );
  const defaultModelInfo = $derived(savedDefaultModelInfo ?? availableModels[0]);
  const effectivePermissionLevel = $derived(
    settingsDraft.rememberLastAgentSelection
      ? settingsDraft.lastAgentSelection.permissionLevel
      : settingsDraft.defaultPermissionLevel,
  );
  const modelItems = $derived<SelectItem[]>([
    {
      value: "auto",
      label: "First available scoped model",
      detail: "Use the first configured model allowed by Scoped Models",
    },
    ...availableModels.map((model) => ({
      value: modelKey(model),
      label: contextualModelLabel(model, availableModels),
      detail: `${providerDisplayName(model.provider)} · ${model.modelId}`,
    })),
  ]);
  const thinkingItems = $derived<SelectItem[]>(
    (defaultModelInfo?.supportedThinkingLevels?.length
      ? defaultModelInfo.supportedThinkingLevels
      : ["off"]
    ).map((level) => ({ value: level, label: level })),
  );
  const defaultThinkingLevel = $derived(
    clampThinkingLevelForModel(
      settingsDraft.defaultThinkingLevel,
      defaultModelInfo,
    ),
  );

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

  function updateDefaultThinkingLevel(
    thinkingLevel: Settings["defaultThinkingLevel"],
  ) {
    settingsDraft.defaultThinkingLevel = thinkingLevel;
    onSettingsChange?.({ defaultThinkingLevel: thinkingLevel }, { immediate: true });
  }

  function onDefaultModelChange(value: string) {
    const model = value === "auto" ? undefined : parseModelKey(value);
    const selectedInfo = model
      ? availableModels.find((candidate) => modelKey(candidate) === modelKey(model))
      : availableModels[0];
    const thinkingLevel = clampThinkingLevelForModel(
      settingsDraft.defaultThinkingLevel,
      selectedInfo,
    );
    settingsDraft.defaultModel = model;
    settingsDraft.defaultThinkingLevel = thinkingLevel;
    onSettingsChange?.(
      {
        defaultModel: model ?? null,
        defaultThinkingLevel: thinkingLevel,
      },
      { immediate: true },
    );
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

<section id="settings-agents" class="settings-section" data-section="agents">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><Bot size={14} strokeWidth={2.1} /> Agents</div>
    <h2>Default behavior and policy</h2>
    <p>Choose how new top-level agents pick their mode, permission, model, and thinking budget.</p>
  </header>
  <div class="settings-section-body">
    <Switch
      class="settings-full-switch"
      checked={settingsDraft.rememberLastAgentSelection}
      label="Use last selections for new agents"
      description="When enabled, new conversations reuse the last mode, permission, model, and thinking level you selected in the composer."
      onCheckedChange={onRememberLastSelectionChange}
    />

    <Switch
      class="settings-full-switch"
      checked={settingsDraft.compaction.auto}
      label="Auto-compact long conversations"
      description="Automatically summarize older context when the selected model approaches its context window."
      onCheckedChange={onAutoCompactionChange}
    />

    <div class="settings-control-grid">
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Root mode</strong>
          <span>The fixed starting workflow when last selections are disabled.</span>
        </div>
        <RadioGroup
          items={modeItems}
          value={settingsDraft.defaultMode}
          ariaLabel="Default root mode"
          onValueChange={(value) => {
            const next = value as Settings["defaultMode"];
            settingsDraft.defaultMode = next;
            onSettingsChange?.({ defaultMode: next }, { immediate: true });
          }}
        />
      </div>
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Root permission</strong>
          <span>The fixed approval policy when last selections are disabled.</span>
        </div>
        <RadioGroup
          items={permissionItems}
          value={settingsDraft.defaultPermissionLevel}
          ariaLabel="Default root permission"
          onValueChange={(value) => {
            const next = value as Settings["defaultPermissionLevel"];
            settingsDraft.defaultPermissionLevel = next;
            onSettingsChange?.({ defaultPermissionLevel: next }, { immediate: true });
          }}
        />
      </div>

      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Root model</strong>
          <span>The fixed model for new top-level agents when last selections are disabled.</span>
        </div>
        <SelectField
          items={modelItems}
          value={defaultModelKey}
          ariaLabel="Default root model"
          onValueChange={onDefaultModelChange}
        />
      </div>

      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Thinking level</strong>
          <span>The fixed reasoning budget when last selections are disabled.</span>
        </div>
        <SelectField
          items={thinkingItems}
          value={defaultThinkingLevel}
          ariaLabel="Default root thinking level"
          onValueChange={(value) => updateDefaultThinkingLevel(value as Settings["defaultThinkingLevel"])}
        />
      </div>
    </div>

    <div class="permission-table" role="table" aria-label="Default agent permissions">
      <div role="row"><span role="columnheader">Capability</span><span role="columnheader">New-agent policy</span></div>
      <div role="row"><span>File system read</span><strong>Allowed</strong></div>
      <div role="row"><span>File system write</span><strong>{writePolicy(effectivePermissionLevel)}</strong></div>
      <div role="row">
        <span>Terminal command execution</span><strong>{commandPolicy(effectivePermissionLevel)}</strong>
      </div>
      <div role="row"><span>Network access</span><strong>Tool-dependent</strong></div>
    </div>
  </div>
</section>
