<script lang="ts">
  import SearchCode from "@lucide/svelte/icons/search-code";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    ModelSelection,
    Settings,
    UpdateSettingsRequest,
  } from "$lib/api";
  import SelectField, { type SelectItem } from "$lib/components/ui/select-field";
  import {
    contextualModelLabel,
    modelKey,
    parseModelKey,
    providerDisplayName,
    usableModelOptions,
  } from "$lib/core/utils/model";

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

  let { settingsDraft, models = [], authProviders = [], onSettingsChange }: Props = $props();

  const availableModels = $derived(usableModelOptions(models, authProviders));
  const selectedModelKey = $derived(settingsDraft.exploreAgent.model ? modelKey(settingsDraft.exploreAgent.model) : "default");
  const selectedModelInfo = $derived(
    settingsDraft.exploreAgent.model
      ? availableModels.find((model) => modelKey(model) === modelKey(settingsDraft.exploreAgent.model as ModelSelection))
      : undefined,
  );
  const modelItems = $derived<SelectItem[]>([
    { value: "default", label: "Default model", detail: "Use the platform fallback model" },
    ...availableModels.map((model) => ({
      value: modelKey(model),
      label: contextualModelLabel(model, availableModels),
      detail: `${providerDisplayName(model.provider)} · ${model.modelId}`,
    })),
  ]);
  const thinkingItems = $derived<SelectItem[]>(
    (selectedModelInfo?.supportedThinkingLevels?.length
      ? selectedModelInfo.supportedThinkingLevels
      : ["off", "minimal", "low", "medium", "high", "xhigh"]
    ).map((level) => ({ value: level, label: level })),
  );

  function updateExploreAgent(patch: Partial<Settings["exploreAgent"]>) {
    settingsDraft.exploreAgent = { ...settingsDraft.exploreAgent, ...patch };
    onSettingsChange?.({ exploreAgent: patch }, { immediate: true });
  }

  function onModelChange(value: string) {
    if (value === "default") {
      settingsDraft.exploreAgent = { ...settingsDraft.exploreAgent, model: undefined };
      onSettingsChange?.({ exploreAgent: { model: null } }, { immediate: true });
      return;
    }
    const model = parseModelKey(value);
    if (model) updateExploreAgent({ model });
  }
</script>

<section id="settings-explore" class="settings-section" data-section="explore">
  <header class="settings-section-header">
    <div class="settings-section-kicker"><SearchCode size={14} strokeWidth={2.1} /> Explore agent</div>
    <h2>Codebase exploration delegate</h2>
    <p>Configure the specialized read-only agent used by the explore tool.</p>
  </header>

  <div class="settings-section-body">
    <div class="settings-control-grid">
      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Explore model</strong>
          <span>The model used when parent agents delegate codebase exploration.</span>
        </div>
        <SelectField
          items={modelItems}
          value={selectedModelKey}
          ariaLabel="Explore agent model"
          onValueChange={onModelChange}
        />
      </div>

      <div class="settings-row settings-row-stacked">
        <div class="settings-copy">
          <strong>Thinking level</strong>
          <span>Reasoning budget for explore reports.</span>
        </div>
        <SelectField
          items={thinkingItems}
          value={settingsDraft.exploreAgent.thinkingLevel}
          ariaLabel="Explore agent thinking level"
          onValueChange={(value) => updateExploreAgent({ thinkingLevel: value as Settings["exploreAgent"]["thinkingLevel"] })}
        />
      </div>
    </div>

    <div class="permission-table" role="table" aria-label="Explore agent fixed policy">
      <div role="row"><span role="columnheader">Capability</span><span role="columnheader">Explore policy</span></div>
      <div role="row"><span>Permission</span><strong>Read only</strong></div>
      <div role="row"><span>Mode</span><strong>Coding</strong></div>
      <div role="row"><span>Working directory</span><strong>Same as parent</strong></div>
      <div role="row"><span>Conversation history</span><strong>Fresh</strong></div>
    </div>
  </div>
</section>
