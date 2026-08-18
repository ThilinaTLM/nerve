<script lang="ts">
import { SvelteSet } from "svelte/reactivity";
import type {
  AuthProviderMetadata,
  ModelInfo,
  ModelSelection,
  Settings,
  ThinkingLevel,
  StatusResponse,
} from "$lib/api";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import {
  SettingsFieldRow,
  SettingsGroup,
  SettingsInlineMessage,
  SettingsList,
  SettingsSummaryRow,
  SettingsToggleRow,
} from "$lib/presentation/components/settings";
import {
  modelDisplayName,
  modelKey,
  providerDisplayName,
  supportsImageInput,
  usableModelOptions,
} from "$lib/presentation/utils/model";
import SingleModelSelectionDialog from "../../shared/SingleModelSelectionDialog.svelte";
import type { SettingsChange } from "../settings-change";
import PythonRuntimeDialog from "./PythonRuntimeDialog.svelte";
import ToolConfigureButton from "./ToolConfigureButton.svelte";
import ToolGroupItem from "./ToolGroupItem.svelte";
import ToolProfileDialog from "./ToolProfileDialog.svelte";
import { tavilyProfileReady } from "../providers/provider-profiles";
import {
  configurableToolOrder,
  toolGroups,
  type ConfigurableToolName,
  type ToolCategory,
  type ToolGroupDef,
} from "./tool-catalog";
import { ensureToolsDraft } from "./tools-draft";

type Props = {
  settingsDraft: Settings;
  status?: StatusResponse;
  authProviders?: AuthProviderMetadata[];
  models?: ModelInfo[];
  onSettingsChange?: SettingsChange;
  category?: ToolCategory;
};

let {
  settingsDraft,
  status,
  authProviders = [],
  models = [],
  onSettingsChange,
  category = "core",
}: Props = $props();

let pythonDialogOpen = $state(false);
let visionModelDialogOpen = $state(false);
let webDialogOpen = $state(false);

const disabledTools = $derived(new Set(settingsDraft.tools?.disabled ?? []));
const python = $derived(status?.runtime.python);
const sourceLabel = $derived(
  (python?.source ?? "unavailable").replace(/_/g, " "),
);
const selectedTavilyProfile = $derived(
  settingsDraft.providers.tavilyProfiles.find(
    (profile) => profile.id === settingsDraft.tools.web.tavilyProfileId,
  ),
);
const tavilyConfigured = $derived(
  tavilyProfileReady(selectedTavilyProfile, authProviders),
);
const bashAutoPromotion = $derived(settingsDraft.tools.bash.autoPromotion);
const usableVisionModels = $derived(
  usableModelOptions(models, authProviders).filter(supportsImageInput),
);
const configuredVisionSelection = $derived(
  settingsDraft.tools.imageExplanation.model,
);
const configuredVisionModel = $derived(
  configuredVisionSelection
    ? usableVisionModels.find(
        (model) => modelKey(model) === modelKey(configuredVisionSelection),
      )
    : undefined,
);
const visionReady = $derived(Boolean(configuredVisionModel));

function groupEnabled(group: ToolGroupDef): boolean {
  if (group.configurableTools.length === 0) return true;
  if (group.id === "vision" && !visionReady) return false;
  return group.configurableTools.every((name) => !disabledTools.has(name));
}

function setToolsEnabled(
  names: ConfigurableToolName[],
  enabled: boolean,
): void {
  if (enabled && names.includes("explain_image") && !visionReady) return;
  if (enabled && names.includes("web_search") && !tavilyConfigured) return;
  const tools = ensureToolsDraft(settingsDraft);
  const next = new SvelteSet(tools.disabled);
  for (const name of names) {
    if (enabled) next.delete(name);
    else next.add(name);
  }
  const disabled = configurableToolOrder.filter((name) => next.has(name));
  tools.disabled = disabled;
  onSettingsChange?.({ tools: { disabled } }, { immediate: true });
}

function saveVisionModel(selection: {
  model?: ModelSelection;
  thinkingLevel: ThinkingLevel;
}): void {
  const model = selection.model;
  settingsDraft.tools.imageExplanation.model = model;
  settingsDraft.tools.imageExplanation.thinkingLevel = selection.thinkingLevel;
  onSettingsChange?.(
    {
      tools: {
        imageExplanation: {
          model: model ?? null,
          thinkingLevel: selection.thinkingLevel,
        },
      },
    },
    { immediate: true },
  );
  if (!model) setToolsEnabled(["explain_image"], false);
}

function setTavilyProfile(profileId?: string): void {
  const next = profileId || undefined;
  settingsDraft.tools.web.tavilyProfileId = next;
  onSettingsChange?.(
    { tools: { web: { tavilyProfileId: next ?? null } } },
    { immediate: true },
  );
  const profile = settingsDraft.providers.tavilyProfiles.find(
    (item) => item.id === next,
  );
  if (!tavilyProfileReady(profile, authProviders)) {
    setToolsEnabled(["web_search", "web_fetch"], false);
  }
}

function setBashAutoPromotionEnabled(enabled: boolean): void {
  settingsDraft.tools.bash.autoPromotion.enabled = enabled;
  onSettingsChange?.(
    { tools: { bash: { autoPromotion: { enabled } } } },
    { immediate: true },
  );
}

function updateBashAutoPromotionSeconds(value: string): void {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return;
  const afterMs = seconds * 1000;
  settingsDraft.tools.bash.autoPromotion.afterMs = afterMs;
  onSettingsChange?.(
    { tools: { bash: { autoPromotion: { afterMs } } } },
    { debounceMs: 650 },
  );
}
</script>

<SettingsGroup>
  <SettingsList
    ariaLabel={`${category === "core" ? "Core" : "Third-party"} tool groups`}
  >
    {#each toolGroups.filter((group) => group.category === category) as group (group.id)}
      {@const enabled = groupEnabled(group)}
      {@const alwaysOn = group.configurableTools.length === 0}
      <ToolGroupItem
        title={group.label}
        description={group.description}
        tools={group.tools}
      >
        {#snippet actions()}
          {#if group.id === "web"}
            <ToolConfigureButton
              label="Configure Web access"
              onclick={() => (webDialogOpen = true)}
            />
          {:else if group.id === "vision"}
            <ToolConfigureButton
              label="Configure Image explanation"
              onclick={() => (visionModelDialogOpen = true)}
            />
          {:else if group.id === "python"}
            <ToolConfigureButton
              label="Configure Python"
              onclick={() => (pythonDialogOpen = true)}
            />
          {/if}
          {#if alwaysOn}
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <span {...props}>
                      <Switch
                        checked
                        disabled
                        size="settings"
                        aria-label={`${group.label} tools are always enabled`}
                      />
                    </span>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="top">Always on</Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          {:else}
            <Switch
              size="settings"
              checked={enabled}
              disabled={(group.id === "vision" && !visionReady) ||
                (group.id === "web" && !tavilyConfigured)}
              aria-label={`Enable ${group.label} tools`}
              onCheckedChange={(checked) =>
                setToolsEnabled(group.configurableTools, checked)}
            />
          {/if}
        {/snippet}
        {#snippet extra()}
          {#if group.id === "shell"}
            <div class="grid gap-2 pt-1">
              <SettingsToggleRow
                label="Automatic backgrounding"
                description="Promote Bash calls that are still running after the configured delay."
                checked={bashAutoPromotion.enabled}
                onCheckedChange={setBashAutoPromotionEnabled}
              />
              <SettingsFieldRow
                id="tools-bash-auto-promotion-seconds"
                label="Background after"
                type="number"
                min={1}
                max={86_400}
                step={1}
                suffix="seconds"
                disabled={!bashAutoPromotion.enabled}
                class="max-w-xs"
                value={String(bashAutoPromotion.afterMs / 1000)}
                onValueChange={updateBashAutoPromotionSeconds}
              />
            </div>
          {:else if group.id === "web"}
            <SettingsSummaryRow
              class="mt-1"
              title="Tavily profile"
              status={tavilyConfigured ? "ok" : "warning"}
            >
              {#snippet meta()}
                {tavilyConfigured
                  ? "Configured for web search."
                  : "Select a configured profile to enable web access."}
              {/snippet}
            </SettingsSummaryRow>
          {:else if group.id === "vision"}
            <SettingsSummaryRow
              class="mt-1"
              title={configuredVisionModel
                ? modelDisplayName(configuredVisionModel)
                : configuredVisionSelection
                  ? `${configuredVisionSelection.provider}/${configuredVisionSelection.modelId}`
                  : "Vision model not configured"}
              status={configuredVisionModel
                ? "ok"
                : configuredVisionSelection
                  ? "warning"
                  : "muted"}
            >
              {#snippet meta()}
                {#if configuredVisionModel}
                  {providerDisplayName(configuredVisionModel.provider)} · Image input
                  · Thinking {settingsDraft.tools.imageExplanation
                    .thinkingLevel}
                {:else if configuredVisionSelection}
                  Configured model is unavailable or does not support images.
                {:else}
                  Choose an image-capable model before enabling this tool.
                {/if}
              {/snippet}
            </SettingsSummaryRow>
          {:else if group.id === "python"}
            <SettingsSummaryRow
              class="mt-1"
              title={python?.available
                ? "Runtime available"
                : "Runtime unavailable"}
              status={python?.available ? "ok" : "warning"}
            >
              {#snippet meta()}
                {#if python?.available}
                  {python.version ?? "Unknown version"} · {sourceLabel} ·
                  <span class="font-mono"
                    >{python.executable ?? "No executable"}</span
                  >
                {:else}
                  {python?.error ?? "No Python runtime was detected."}
                {/if}
              {/snippet}
            </SettingsSummaryRow>
            <SettingsInlineMessage
              tone="info"
              text="Planning-mode Python runs with file-write guardrails. This is not a hard security sandbox."
            />
          {/if}
        {/snippet}
      </ToolGroupItem>
    {/each}
  </SettingsList>
</SettingsGroup>

<ToolProfileDialog
  bind:open={webDialogOpen}
  title="Configure Web access"
  description="Select the Tavily profile used for web search and URL fetching."
  profiles={settingsDraft.providers.tavilyProfiles}
  selectedProfileId={settingsDraft.tools.web.tavilyProfileId}
  providerSection="tavily-profiles"
  onSave={setTavilyProfile}
/>

<SingleModelSelectionDialog
  bind:open={visionModelDialogOpen}
  title="Choose image explanation model"
  description="Only configured models that accept image input are shown."
  models={usableVisionModels}
  selectedModel={configuredVisionSelection}
  selectedThinkingLevel={settingsDraft.tools.imageExplanation.thinkingLevel}
  emptyMessage="No configured image-capable models are available."
  confirmLabel="Save model"
  onSave={saveVisionModel}
/>

<PythonRuntimeDialog
  bind:open={pythonDialogOpen}
  {settingsDraft}
  {python}
  {onSettingsChange}
/>
