<script lang="ts">
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import type { SettingsChange } from "../settings-change";
import AgentDefaultsTab from "./AgentDefaultsTab.svelte";
import CompactionTab from "./CompactionTab.svelte";
import ExploreAgentTab from "./ExploreAgentTab.svelte";

type Props = {
  activeTabId: string;
  settingsDraft: Settings;
  models: ModelInfo[];
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};

let {
  activeTabId,
  settingsDraft,
  models = [],
  authProviders = [],
  onSettingsChange,
}: Props = $props();
</script>

{#if activeTabId === "defaults"}
  <AgentDefaultsTab
    {settingsDraft}
    {models}
    {authProviders}
    {onSettingsChange}
  />
{:else if activeTabId === "compaction"}
  <CompactionTab {settingsDraft} {onSettingsChange} />
{:else if activeTabId === "explore"}
  <ExploreAgentTab
    {settingsDraft}
    {models}
    {authProviders}
    {onSettingsChange}
  />
{/if}
