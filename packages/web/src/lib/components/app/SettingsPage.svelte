<script lang="ts">
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { Settings, StatusResponse, UpdateSettingsRequest } from "../../api";
  import type { ThemePreference } from "../../state/app-state.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import AppearanceSettingsSection from "./settings/sections/AppearanceSettingsSection.svelte";
  import AgentsSettingsSection from "./settings/sections/AgentsSettingsSection.svelte";
  import CompactionSettingsSection from "./settings/sections/CompactionSettingsSection.svelte";
  import GeneralSettingsSection from "./settings/sections/GeneralSettingsSection.svelte";
  import ServerSettingsSection from "./settings/sections/ServerSettingsSection.svelte";
  import "./settings/settings.css";

  type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
  type SectionId = "appearance" | "agents" | "server" | "compaction" | "runtime";
  type SettingsChange = (
    patch: UpdateSettingsRequest,
    options?: { immediate?: boolean; debounceMs?: number },
  ) => void;

  type Props = {
    status?: StatusResponse;
    settingsDraft?: Settings;
    settingsSaveStatus?: SettingsSaveStatus;
    settingsMessage?: string;
    onSettingsChange?: SettingsChange;
    onThemeChange?: (theme: ThemePreference) => void;
  };

  const sections: { id: SectionId; label: string; detail: string }[] = [
    { id: "appearance", label: "Appearance", detail: "Theme" },
    { id: "agents", label: "Agents", detail: "Defaults" },
    { id: "server", label: "Server", detail: "Binding" },
    { id: "compaction", label: "Compaction", detail: "Context" },
    { id: "runtime", label: "Runtime", detail: "Read-only" },
  ];

  let {
    status,
    settingsDraft = $bindable<Settings | undefined>(),
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
        <AgentsSettingsSection {settingsDraft} {onSettingsChange} />
        <ServerSettingsSection {settingsDraft} {onSettingsChange} />
        <CompactionSettingsSection {settingsDraft} {onSettingsChange} />
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
