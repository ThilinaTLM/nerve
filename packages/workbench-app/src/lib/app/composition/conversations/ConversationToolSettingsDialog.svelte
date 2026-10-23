<!--
  Conversation-level tool configuration with the same dialog as Settings → Tools,
  seeded with the conversation's effective payload. Saving stores a
  conversation choice; cleared optional local fields are reset explicitly.
-->
<script lang="ts">
import { toolSettingsMutation } from "$lib/features/settings/views/pages/tools/tool-settings-mutation";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { AgentEditorView } from "$lib/presentation/composer/agent-editor-view";
import { authenticatedRealModelOptions } from "$lib/presentation/utils/model";
import type { CapabilityToolGroup } from "$lib/presentation/composer/capability-tool-labels";
import {
  agentProfileCatalog,
  leadAgentProfiles,
} from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { openSettingsPane } from "$lib/application/settings";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import ToolConfigDialog from "$lib/features/settings/views/pages/tools/ToolConfigDialog.svelte";
import {
  toolRow,
  type ToolId,
  type ToolPayload,
} from "$lib/features/settings/views/pages/tools/tool-settings";
import { sourceLabel } from "$lib/presentation/settings/configuration-source";

type Props = {
  configuration?: AgentEditorView;
  /** The tool group being configured; clearing it closes the dialog. */
  group?: CapabilityToolGroup;
  projectId?: string;
  onPatch: (patch: LeadSettingsOverrides, resets?: string[]) => void;
  onClose: () => void;
};

let { configuration, group, projectId, onPatch, onClose }: Props = $props();

/** The tool of the group that has something to configure. */
const toolId = $derived<ToolId | undefined>(
  group?.names.find((name) => toolRow(name).configurable),
);
const value = $derived<ToolPayload>(
  toolId ? (configuration?.resolution.settings.tools?.[toolId] ?? {}) : {},
);
const accounts = $derived(
  toolId === "web_search"
    ? (settingsState.settingsDraft?.providers.tavilyProfiles ?? [])
    : (settingsState.settingsDraft?.providers.atlassianProfiles.map((p) => ({
        id: p.id,
        name: p.name,
        detail: p.siteUrl,
      })) ?? []),
);
const noAccountLabel = "No account";
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
  `${sourceLabel(toolId ? configuration?.resolution.provenance[`/tools/${toolId}/enabled`] : undefined)}. Applies only to this conversation.`,
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
    onSave={(next) => {
      const mutation = toolSettingsMutation(
        toolId,
        next,
        configuration.overrides,
      );
      onPatch(mutation.changes, mutation.resets);
    }}
  />
{/if}
