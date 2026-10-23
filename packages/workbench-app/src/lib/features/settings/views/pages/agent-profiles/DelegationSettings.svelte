<script lang="ts">
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import type { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import type { AuthProviderMetadata, ModelInfo } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import ModelPicker from "$lib/presentation/model-picker/ModelPicker.svelte";
import { SettingsRow, SettingsSection } from "$lib/presentation/settings";
import { sameConfigurationSource } from "$lib/presentation/settings/configuration-source";
import ConfigurationSource from "$lib/presentation/settings/ConfigurationSource.svelte";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
let {
  editor,
  projectId,
  models = [],
  authProviders = [],
}: {
  editor: ScopedAgentState;
  projectId?: string;
  models?: ModelInfo[];
  authProviders?: AuthProviderMetadata[];
} = $props();
$effect(() => {
  if (workbenchStartupState.progressiveActive)
    void agentProfileCatalog.ensure(projectId);
});
const profiles = $derived(
  agentProfileCatalog.profiles(projectId).filter((p) => p.usableBy !== "lead"),
);
const usableModels = $derived(
  authenticatedRealModelOptions(models, authProviders),
);
const escape = (name: string) =>
  name.replaceAll("~", "~0").replaceAll("/", "~1");
</script>
<SettingsSection
  title="Sub-agent launches"
  description="Per-profile launch choices. New sub-agents never copy their parent's settings."
  divided
>
  {#each profiles as profile (profile.name)}
    {@const value = editor.resolution?.settings.subagents?.[profile.name]}
    {@const pointer = `/subagents/${escape(profile.name)}`}
    {@const modelRequired =
      editor.resolution?.provenance[`${pointer}/model`]?.source ===
      "requirement"}
    {@const reasoningRequired =
      editor.resolution?.provenance[`${pointer}/reasoningLevel`]?.source ===
      "requirement"}
    <SettingsRow
      label={profile.label}
      description={profile.error ?? profile.description}
    >
      {#snippet badges()}<ConfigurationSource
          emptyLabel="Inherited"
          provenance={editor.resolution?.provenance[`${pointer}/model`]}
        />{#if !sameConfigurationSource(editor.resolution?.provenance[`${pointer}/model`], editor.resolution?.provenance[`${pointer}/reasoningLevel`])}<ConfigurationSource
            emptyLabel="Inherited"
            provenance={editor.resolution?.provenance[
              `${pointer}/reasoningLevel`
            ]}
            modelLabel={value?.model?.modelId}
          />{/if}{/snippet}
      {#snippet control()}
        <ModelPicker
          label={`${profile.label} launch model`}
          models={usableModels}
          value={value?.model}
          thinkingLevel={value?.reasoningLevel}
          disabled={editor.saving || !editor.resolution || !!profile.error}
          modelDisabled={modelRequired}
          thinkingDisabled={reasoningRequired}
          lockReason="Required by the active profile"
          onChange={(next) => {
            if (next.model)
              void editor.save({
                subagents: {
                  [profile.name]: {
                    model: next.model,
                    reasoningLevel: next.thinkingLevel,
                  },
                },
              });
          }}
        />
        <Switch
          aria-label={`Enable ${profile.label} launches`}
          checked={value?.enabled ?? profile.enabled}
          disabled={editor.saving ||
            !editor.resolution ||
            !!profile.error ||
            editor.resolution?.provenance[`${pointer}/enabled`]?.source ===
              "requirement"}
          onCheckedChange={(enabled) =>
            editor.save({ subagents: { [profile.name]: { enabled } } })}
        />
        {#if editor.overrides.subagents?.[profile.name]}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Reset ${profile.label} launch choices`}
            disabled={editor.saving}
            onclick={() => editor.save({}, [`/overrides${pointer}`])}>↺</Button
          >
        {/if}
      {/snippet}
    </SettingsRow>
  {/each}
  {#if profiles.length === 0}<p class="p-3 text-xs text-muted-foreground">
      No sub-agent profiles are available.
    </p>{/if}
</SettingsSection>
