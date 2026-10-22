<!--
  Conversation-level tool configuration with the same dialog as Settings → Tools,
  seeded with the conversation's effective payload. Saving stores a
  conversation override; the host drops whatever equals the inherited value.
-->
<script lang="ts">
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import {
  capabilityToolState,
  type CapabilityToolState,
} from "$lib/presentation/composer/capability-origin";
import type { CapabilityToolGroup } from "$lib/presentation/composer/capability-tool-labels";
import {
  agentProfileCatalog,
  leadAgentProfiles,
} from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { openSettingsPane } from "$lib/application/settings";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ToolConfigDialog from "$lib/features/settings/views/pages/tools/ToolConfigDialog.svelte";
import {
  projectToolPatch,
  projectToolPayload,
  toolRow,
  type ToolId,
  type ToolPayload,
} from "$lib/features/settings/views/pages/tools/tool-settings";
import { inheritedProfileLabel } from "./conversation-tool-settings";

type Props = {
  configuration?: CapabilityConfiguration;
  /** The tool group being configured; clearing it closes the dialog. */
  group?: CapabilityToolGroup;
  projectId?: string;
  onPatch: (patch: CapabilityPatch) => void;
  onClose: () => void;
};

let { configuration, group, projectId, onPatch, onClose }: Props = $props();

/** The tool of the group that has something to configure. */
const toolId = $derived<ToolId | undefined>(
  group?.names.find((name) => toolRow(name).configurable),
);
const toolState = $derived<CapabilityToolState | undefined>(
  configuration && group
    ? capabilityToolState({
        configuration,
        level: "conversation",
        names: group.names,
      })
    : undefined,
);
const value = $derived<ToolPayload>(
  configuration && toolId
    ? projectToolPayload(configuration.effective, toolId)
    : {},
);
const accounts = $derived(
  toolState?.profileTool && configuration
    ? configuration.toolProfileOptions[toolState.profileTool]
    : [],
);
const noAccountLabel = $derived(
  toolState?.profileTool && configuration
    ? inheritedProfileLabel(
        configuration,
        toolState.profileTool,
        toolState.inheritedFrom,
      )
    : undefined,
);
const usableModels = $derived(
  authenticatedRealModelOptions(
    settingsState.models,
    settingsState.authProviders,
  ),
);
const leadProfiles = $derived(
  leadAgentProfiles(agentProfileCatalog.profiles(projectId)).map((profile) => ({
    name: profile.name,
    label: profile.label,
  })),
);
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
  open = key !== undefined && toolId !== undefined;
});
$effect(() => {
  if (!open && group) onClose();
});
</script>

{#if configuration && group && toolId}
  <ToolConfigDialog
    bind:open
    name={toolId}
    {value}
    description={scopeNote}
    models={usableModels}
    {accounts}
    {noAccountLabel}
    {leadProfiles}
    onManageAccounts={() => void openSettingsPane("integrations")}
    onSave={(next) => onPatch(projectToolPatch(toolId, next))}
  />
{/if}
