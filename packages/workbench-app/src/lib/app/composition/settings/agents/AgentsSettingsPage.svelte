<script lang="ts">
import type { AuthProviderMetadata, ModelInfo, Settings } from "$lib/api";
import { SettingsSection } from "$lib/presentation/settings";
import type { SettingsChange } from "$lib/features/settings/views/pages/settings-change";
import AgentDefaultsSection from "./AgentDefaultsSection.svelte";
import CompactionSection from "./CompactionSection.svelte";
import ExploreAgentSection from "./ExploreAgentSection.svelte";

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
</script>

<SettingsSection id="defaults" title="Defaults">
  <AgentDefaultsSection
    {settingsDraft}
    {models}
    {authProviders}
    {onSettingsChange}
  />
</SettingsSection>

<SettingsSection id="compaction" title="Compaction">
  <CompactionSection {settingsDraft} {onSettingsChange} />
</SettingsSection>

<SettingsSection id="explore" title="Explore agent">
  <ExploreAgentSection
    {settingsDraft}
    {models}
    {authProviders}
    {onSettingsChange}
  />
</SettingsSection>
