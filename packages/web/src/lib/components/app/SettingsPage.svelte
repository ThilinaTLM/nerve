<script lang="ts">
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { AuthProviderMetadata, Settings, StatusResponse } from "../../api";
  import type { ThemePreference } from "../../state/app-state.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import AppearanceSettingsSection from "./settings/sections/AppearanceSettingsSection.svelte";
  import AgentsSettingsSection from "./settings/sections/AgentsSettingsSection.svelte";
  import GeneralSettingsSection from "./settings/sections/GeneralSettingsSection.svelte";
  import NetworkSettingsSection from "./settings/sections/NetworkSettingsSection.svelte";
  import ProvidersSettingsSection from "./settings/sections/ProvidersSettingsSection.svelte";
  import SettingsHeader from "./settings/SettingsHeader.svelte";
  import SettingsRail from "./settings/SettingsRail.svelte";
  import "./settings/settings.css";
  import type { SettingsSection } from "./settings/options";

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

  let activeSection = $state<SettingsSection>("general");

  const configuredProviders = $derived(
    authProviders.filter((provider) => provider.configured).length,
  );
</script>

<section class="settings-page">
  <SettingsHeader
    {activeSection}
    canSave={Boolean(settingsDraft)}
    {onLoadSettings}
    {onSaveSettings}
  />

  <div class="settings-grid">
    <SettingsRail
      bind:activeSection
      {configuredProviders}
      providerCount={authProviders.length}
      {themePreference}
    />

    <ScrollArea class="settings-scroll" viewportClass="settings-viewport" type="auto">
      {#if !settingsDraft}
        <section class="settings-card app-card empty-card app-empty-state">
          <Sparkles size={28} strokeWidth={1.8} />
          <strong>Settings are loading</strong>
          <p>Refresh if this takes longer than expected.</p>
        </section>
      {:else}
        <div class="settings-main">
          {#if activeSection === "general"}
            <GeneralSettingsSection {status} />
          {/if}

          {#if activeSection === "appearance"}
            <AppearanceSettingsSection {settingsDraft} {onThemeChange} />
          {/if}

          {#if activeSection === "providers"}
            <ProvidersSettingsSection {authProviders} />
          {/if}

          {#if activeSection === "agents"}
            <AgentsSettingsSection {settingsDraft} />
          {/if}

          {#if activeSection === "network"}
            <NetworkSettingsSection {settingsDraft} />
          {/if}

          {#if settingsMessage}<p class="settings-message">{settingsMessage}</p>{/if}
        </div>
      {/if}
    </ScrollArea>
  </div>
</section>
