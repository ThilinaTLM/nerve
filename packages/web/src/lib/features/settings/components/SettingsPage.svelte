<script lang="ts">
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    Settings,
    StatusResponse,
    UpdateSettingsRequest,
  } from "$lib/api";
  import type { ThemePreference } from "$lib/state/app-state.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import AppearanceSettingsSection from "./settings/sections/AppearanceSettingsSection.svelte";
  import AgentsSettingsSection from "./settings/sections/AgentsSettingsSection.svelte";
  import DesktopSettingsSection from "./settings/sections/DesktopSettingsSection.svelte";
  import ExploreAgentSettingsSection from "./settings/sections/ExploreAgentSettingsSection.svelte";
  import GeneralSettingsSection from "./settings/sections/GeneralSettingsSection.svelte";
  import ProvidersSettingsSection from "./settings/sections/ProvidersSettingsSection.svelte";
  import PythonRuntimeSettingsSection from "./settings/sections/PythonRuntimeSettingsSection.svelte";
  import ScopedModelsSettingsSection from "./settings/sections/ScopedModelsSettingsSection.svelte";
  import ServerSettingsSection from "./settings/sections/ServerSettingsSection.svelte";
  import "./settings/settings.css";

  type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
  type SectionId = "appearance" | "desktop" | "agents" | "explore" | "providers" | "models" | "server" | "python" | "runtime";
  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type Props = {
    status?: StatusResponse;
    settingsDraft?: Settings;
    models?: ModelInfo[];
    authProviders?: AuthProviderMetadata[];
    settingsSaveStatus?: SettingsSaveStatus;
    settingsMessage?: string;
    onSettingsChange?: SettingsChange;
    onThemeChange?: (theme: ThemePreference) => void;
  };

  const sections: { id: SectionId; label: string; detail: string }[] = [
    { id: "appearance", label: "Appearance", detail: "Theme" },
    { id: "desktop", label: "Desktop", detail: "Window" },
    { id: "agents", label: "Agents", detail: "Defaults" },
    { id: "explore", label: "Explore agent", detail: "Delegate" },
    { id: "providers", label: "Providers", detail: "Auth" },
    { id: "models", label: "Models", detail: "Scope" },
    { id: "server", label: "Server", detail: "Binding" },
    { id: "python", label: "Python", detail: "Runtime" },
    { id: "runtime", label: "Runtime", detail: "Read-only" },
  ];

  let {
    status,
    settingsDraft = $bindable<Settings | undefined>(),
    models = [],
    authProviders = [],
    settingsSaveStatus = "idle",
    settingsMessage,
    onSettingsChange,
    onThemeChange,
  }: Props = $props();

  let activeSection = $state<SectionId>("appearance");

  function scrollToSection(id: SectionId) {
    activeSection = id;
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function statusText() {
    if (settingsMessage) return settingsMessage;
    if (settingsSaveStatus === "saving") return "Saving…";
    if (settingsSaveStatus === "dirty") return "Unsaved changes";
    if (settingsSaveStatus === "saved") return "Saved";
    if (settingsSaveStatus === "error") return "Could not save settings";
    return "Auto save enabled";
  }
</script>

<section class="settings-page">
  <aside class="settings-sidebar" aria-label="Settings sections">
    <div class="settings-sidebar-title">
      <strong>Settings</strong>
      <span>Auto-saved</span>
    </div>
    <nav class="settings-nav">
      {#each sections as section}
        <button
          type="button"
          class:active={activeSection === section.id}
          onclick={() => scrollToSection(section.id)}
        >
          <span>{section.label}</span>
          <small>{section.detail}</small>
        </button>
      {/each}
    </nav>
    <div class="settings-save-state" data-status={settingsSaveStatus}>
      <span></span>
      <p>{statusText()}</p>
    </div>
  </aside>

  <ScrollArea class="settings-scroll" viewportClass="settings-viewport" type="auto">
    <div class="settings-main">
      {#if settingsDraft}
        <AppearanceSettingsSection {settingsDraft} {onThemeChange} {onSettingsChange} />
        <DesktopSettingsSection {settingsDraft} {onSettingsChange} />
        <AgentsSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
        <ExploreAgentSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
        <ProvidersSettingsSection {authProviders} />
        <ScopedModelsSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
        <ServerSettingsSection {settingsDraft} {onSettingsChange} />
        <PythonRuntimeSettingsSection {settingsDraft} {status} {onSettingsChange} />
        <GeneralSettingsSection {status} />
      {:else}
        <section class="app-empty-state settings-loading">
          <Sparkles size={28} strokeWidth={1.8} />
          <strong>Settings are loading</strong>
          <p>Use the tab refresh action if this takes longer than expected.</p>
        </section>
      {/if}
    </div>
  </ScrollArea>
</section>
