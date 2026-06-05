<script lang="ts">
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Save from "@lucide/svelte/icons/save";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { AuthProviderMetadata, Settings, StatusResponse } from "../../api";
  import type { ThemePreference } from "../../state/app-state.svelte";
  import { Button } from "$lib/components/ui/button";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import AppearanceSettingsSection from "./settings/sections/AppearanceSettingsSection.svelte";
  import AgentsSettingsSection from "./settings/sections/AgentsSettingsSection.svelte";
  import GeneralSettingsSection from "./settings/sections/GeneralSettingsSection.svelte";
  import NetworkSettingsSection from "./settings/sections/NetworkSettingsSection.svelte";
  import ProvidersSettingsSection from "./settings/sections/ProvidersSettingsSection.svelte";
  import "./settings/settings.css";

  type Props = {
    status?: StatusResponse;
    settingsDraft?: Settings;
    authProviders?: AuthProviderMetadata[];
    settingsMessage?: string;
    themePreference?: ThemePreference;
    onLoadSettings?: () => void;
    onSaveSettings?: () => void;
    onThemeChange?: (theme: ThemePreference) => void;
  };

  let {
    status,
    settingsDraft = $bindable<Settings | undefined>(),
    authProviders = [],
    settingsMessage,
    themePreference = "system",
    onLoadSettings,
    onSaveSettings,
    onThemeChange,
  }: Props = $props();
</script>

<section class="settings-page">
  <header class="settings-header">
    <div class="settings-title">
      <Settings2 size={16} strokeWidth={2.15} aria-hidden="true" />
      <strong>Settings</strong>
    </div>
    <div class="settings-actions">
      <Button variant="ghost" size="sm" onclick={onLoadSettings}>
        <RefreshCw size={13} strokeWidth={2.25} />Refresh
      </Button>
      <Button size="sm" onclick={onSaveSettings} disabled={!settingsDraft}>
        <Save size={13} strokeWidth={2.25} />Save settings
      </Button>
    </div>
  </header>

  <ScrollArea class="settings-scroll" viewportClass="settings-viewport" type="auto">
    <div class="settings-main">
      <GeneralSettingsSection {status} />

      {#if settingsDraft}
        <AppearanceSettingsSection {settingsDraft} {onThemeChange} />
        <ProvidersSettingsSection {authProviders} />
        <AgentsSettingsSection {settingsDraft} />
        <NetworkSettingsSection {settingsDraft} />
      {:else}
        <section class="app-empty-state settings-loading">
          <Sparkles size={28} strokeWidth={1.8} />
          <strong>Settings are loading</strong>
          <p>Refresh if this takes longer than expected.</p>
        </section>
      {/if}

      {#if settingsMessage}<p class="settings-message">{settingsMessage}</p>{/if}
    </div>
  </ScrollArea>
</section>
