<script lang="ts">
import type { AuthProviderMetadata, Settings } from "$lib/api";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import type { SettingsChange } from "../settings-change";
import AtlassianAccountsSection from "./AtlassianAccountsSection.svelte";
import TavilyAccountsSection from "./TavilyAccountsSection.svelte";

type Props = {
  settingsDraft: Settings;
  authProviders: AuthProviderMetadata[];
  onSettingsChange?: SettingsChange;
};
let { settingsDraft, authProviders, onSettingsChange }: Props = $props();

// User-scope tool settings, so each section can pick the account its tools use.
const tools = new ScopedAgentState();
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void tools.load({ scope: "user" });
});
$effect(() => tools.observe());
</script>

<TavilyAccountsSection
  {settingsDraft}
  {authProviders}
  {onSettingsChange}
  {tools}
/>
<AtlassianAccountsSection
  {settingsDraft}
  {authProviders}
  {onSettingsChange}
  {tools}
/>
