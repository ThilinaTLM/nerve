<!--
  Conversation-level tool configuration. Reuses the Settings → Tools dialogs,
  seeded with the conversation's effective values; saving stores a
  conversation override, and a value equal to the inherited one is pruned.
-->
<script lang="ts">
import type { AtlassianProfileHealth } from "@nervekit/contracts/auth";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import { capabilityToolState } from "$lib/presentation/composer/capability-origin";
import type { CapabilityToolGroup } from "$lib/presentation/composer/capability-tool-labels";
import { atlassianHealthBadge } from "$lib/presentation/integrations/atlassian-health";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import AsyncSubagentToolDialog from "$lib/features/settings/views/pages/tools/AsyncSubagentToolDialog.svelte";
import ImageGenerationToolDialog from "$lib/features/settings/views/pages/tools/ImageGenerationToolDialog.svelte";
import KrokiToolDialog from "$lib/features/settings/views/pages/tools/KrokiToolDialog.svelte";
import ToolModelDialog from "$lib/features/settings/views/pages/tools/ToolModelDialog.svelte";
import ToolProfileDialog from "$lib/features/settings/views/pages/tools/ToolProfileDialog.svelte";
import {
  conversationProfileId,
  inheritedProfileLabel,
  modelToolSettingsPatch,
} from "./conversation-tool-settings";

type Props = {
  configuration?: CapabilityConfiguration;
  /** The tool group being configured; clearing it closes the dialog. */
  group?: CapabilityToolGroup;
  profileHealth?: AtlassianProfileHealth[];
  onPatch: (patch: CapabilityPatch) => void;
  onClose: () => void;
};

let {
  configuration,
  group,
  profileHealth = [],
  onPatch,
  onClose,
}: Props = $props();

const toolState = $derived(
  configuration && group
    ? capabilityToolState({
        configuration,
        level: "conversation",
        names: group.names,
      })
    : undefined,
);
const toolSettings = $derived(configuration?.effective.toolSettings);
const usableModels = $derived(
  authenticatedRealModelOptions(
    settingsState.models,
    settingsState.authProviders,
  ),
);
const title = $derived(group ? `Configure ${group.label}` : "");
const scopeNote = $derived(
  toolState
    ? `${toolState.originLabel}. Applies only to this conversation.`
    : "",
);

/* A newly selected group opens its dialog; closing the dialog ends the
 * configuration. Capability refreshes while it is open never reopen it. */
let open = $state(false);
let openedKey: string | undefined;
$effect(() => {
  const key = group?.key;
  if (key === openedKey) return;
  openedKey = key;
  open = key !== undefined;
});
$effect(() => {
  if (!open && group) onClose();
});

function profileStatus(profileId: string) {
  const service = toolState?.profileTool;
  if (service !== "jira" && service !== "confluence") return undefined;
  const result = profileHealth.find((item) => item.profileId === profileId)?.[
    service
  ];
  return result ? atlassianHealthBadge(result) : undefined;
}
</script>

{#if configuration && group && toolState && toolSettings}
  {#if toolState.profileTool}
    {@const tool = toolState.profileTool}
    <ToolProfileDialog
      bind:open
      {title}
      description={scopeNote}
      profiles={toolState.profileOptions}
      selectedProfileId={conversationProfileId(configuration, tool)}
      providerSection={tool === "web_search"
        ? "tavily-profiles"
        : "atlassian-profiles"}
      noneLabel={inheritedProfileLabel(
        configuration,
        tool,
        toolState.inheritedFrom,
      )}
      warning={toolState.profileMissing
        ? "The selected profile is not on this machine. Choose another profile."
        : toolState.needsProfile
          ? `Choose a profile to use ${group.label}.`
          : undefined}
      {profileStatus}
      onSave={(profileId) =>
        onPatch({ tools: { [tool]: { profileId: profileId ?? null } } })}
    />
  {:else if toolState.settingsTool === "explore"}
    <ToolModelDialog
      bind:open
      {title}
      description={scopeNote}
      label="Explore model"
      models={usableModels}
      selectedModel={toolSettings.explore.model}
      selectedThinkingLevel={toolSettings.explore.thinkingLevel}
      inheritOption={{
        label: "Parent agent's model",
        description:
          "Explore agents run on the model of the agent that started them.",
      }}
      onSave={(selection) =>
        onPatch(modelToolSettingsPatch("explore", selection))}
    />
  {:else if toolState.settingsTool === "explain_image"}
    <ToolModelDialog
      bind:open
      {title}
      description={scopeNote}
      label="Image explanation model"
      models={usableModels}
      selectedModel={toolSettings.explain_image.model}
      selectedThinkingLevel={toolSettings.explain_image.thinkingLevel}
      requiredCapabilities={["vision"]}
      emptyMessage="No configured image-capable models are available."
      onSave={(selection) =>
        onPatch(modelToolSettingsPatch("explain_image", selection))}
    />
  {:else if toolState.settingsTool === "generate_image"}
    <ImageGenerationToolDialog
      bind:open
      {title}
      description={scopeNote}
      value={toolSettings.generate_image}
      onSave={(value) => onPatch({ toolSettings: { generate_image: value } })}
    />
  {:else if toolState.settingsTool === "kroki_export"}
    <KrokiToolDialog
      bind:open
      {title}
      description={scopeNote}
      value={toolSettings.kroki_export}
      onSave={(value) => onPatch({ toolSettings: { kroki_export: value } })}
    />
  {:else if toolState.settingsTool === "subagents"}
    <AsyncSubagentToolDialog
      bind:open
      {title}
      description={scopeNote}
      value={toolSettings.subagents}
      models={settingsState.models}
      authProviders={settingsState.authProviders}
      onSave={(value) => onPatch({ toolSettings: { subagents: value } })}
    />
  {/if}
{/if}
