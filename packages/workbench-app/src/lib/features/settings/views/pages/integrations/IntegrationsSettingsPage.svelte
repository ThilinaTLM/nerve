<script lang="ts">
import type { AuthProviderMetadata, Settings } from "$lib/api";
import type { SettingsChange } from "../settings-change";
import AtlassianAccountsSection from "./AtlassianAccountsSection.svelte";
import TavilyAccountsSection from "./TavilyAccountsSection.svelte";

type Props = {
  settingsDraft: Settings;
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};
let { settingsDraft, authProviders, onSettingsChange }: Props = $props();
</script>

<TavilyAccountsSection {settingsDraft} {authProviders} {onSettingsChange} />
<AtlassianAccountsSection {settingsDraft} {authProviders} {onSettingsChange} />
