<script lang="ts">
  import type { Component } from "svelte";
  import Bot from "@lucide/svelte/icons/bot";
  import HardDrive from "@lucide/svelte/icons/hard-drive";
  import Lightbulb from "@lucide/svelte/icons/lightbulb";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Server from "@lucide/svelte/icons/server";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import Wrench from "@lucide/svelte/icons/wrench";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    Settings,
    StatusResponse,
    UpdateSettingsRequest,
  } from "$lib/api";
  import type { ThemePreference } from "$lib/app/layout/layout-state.svelte";
  import {
    SettingsShell,
    SettingsSidebarStatus,
    type SettingsShellGroup,
  } from "@nervekit/workbench-ui/components/settings";
  import AppearanceSettingsSection from "./settings/sections/AppearanceSettingsSection.svelte";
  import AgentsSettingsSection from "./settings/sections/AgentsSettingsSection.svelte";
  import DesktopSettingsSection from "./settings/sections/DesktopSettingsSection.svelte";
  import ExploreAgentSettingsSection from "./settings/sections/ExploreAgentSettingsSection.svelte";
  import GeneralSettingsSection from "./settings/sections/GeneralSettingsSection.svelte";
  import ToolsSettingsSection from "./settings/sections/ToolsSettingsSection.svelte";
  import PromptSuggestionsSettingsSection from "./settings/sections/PromptSuggestionsSettingsSection.svelte";
  import ScopedModelsSettingsSection from "./settings/sections/ScopedModelsSettingsSection.svelte";
  import ServerSettingsSection from "./settings/sections/ServerSettingsSection.svelte";
  import StorageSettingsSection from "./settings/sections/StorageSettingsSection.svelte";

  type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
  type SectionId =
    | "appearance"
    | "desktop"
    | "agents"
    | "explore"
    | "prompt-suggestions"
    | "models"
    | "tools"
    | "server"
    | "storage"
    | "runtime";
  type GroupId = "workbench" | "agents" | "suggestions" | "models" | "tools" | "storage" | "system";
  type GroupSection = { id: SectionId; label: string };
  type SettingsGroup = SettingsShellGroup & {
    id: GroupId;
    label: string;
    icon: Component;
    sections: GroupSection[];
  };
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

  const groups: SettingsGroup[] = [
    {
      id: "workbench",
      label: "Workbench",
      icon: Monitor,
      sections: [
        { id: "appearance", label: "Appearance" },
        { id: "desktop", label: "Desktop" },
      ],
    },
    {
      id: "agents",
      label: "Agents",
      icon: Bot,
      sections: [
        { id: "agents", label: "Default agent" },
        { id: "explore", label: "Explore agent" },
      ],
    },
    {
      id: "suggestions",
      label: "Suggestions",
      icon: Lightbulb,
      sections: [{ id: "prompt-suggestions", label: "Prompt suggestions" }],
    },
    {
      id: "models",
      label: "Models",
      icon: ShieldCheck,
      sections: [{ id: "models", label: "Scoped models" }],
    },
    {
      id: "tools",
      label: "Tools",
      icon: Wrench,
      sections: [{ id: "tools", label: "Tool configuration" }],
    },
    {
      id: "storage",
      label: "Storage",
      icon: HardDrive,
      sections: [{ id: "storage", label: "Storage cleanup" }],
    },
    {
      id: "system",
      label: "System",
      icon: Server,
      sections: [
        { id: "server", label: "Server" },
        { id: "runtime", label: "Diagnostics" },
      ],
    },
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

  function statusText() {
    if (settingsMessage) return settingsMessage;
    if (settingsSaveStatus === "saving") return "Saving…";
    if (settingsSaveStatus === "dirty") return "Unsaved changes";
    if (settingsSaveStatus === "saved") return "Saved";
    if (settingsSaveStatus === "error") return "Could not save settings";
    return "Auto save enabled";
  }
</script>

<SettingsShell {groups} title="Settings" ariaLabel="Settings sections" showPanelHeader={!!settingsDraft}>
  {#snippet sidebarFooter()}
    <SettingsSidebarStatus status={settingsSaveStatus} text={statusText()} />
  {/snippet}

  {#snippet children(activeGroup)}
    {#if settingsDraft}
      {#if activeGroup.id === "workbench"}
        <AppearanceSettingsSection {settingsDraft} {onThemeChange} {onSettingsChange} />
        <DesktopSettingsSection {settingsDraft} {onSettingsChange} />
      {:else if activeGroup.id === "agents"}
        <AgentsSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
        <ExploreAgentSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
      {:else if activeGroup.id === "suggestions"}
        <PromptSuggestionsSettingsSection />
      {:else if activeGroup.id === "models"}
        <ScopedModelsSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
      {:else if activeGroup.id === "tools"}
        <ToolsSettingsSection {settingsDraft} {status} {authProviders} {onSettingsChange} />
      {:else if activeGroup.id === "storage"}
        <StorageSettingsSection />
      {:else if activeGroup.id === "system"}
        <ServerSettingsSection {settingsDraft} {onSettingsChange} />
        <GeneralSettingsSection {status} />
      {/if}
    {:else}
      <section class="app-empty-state settings-loading">
        <Sparkles size={28} strokeWidth={1.8} />
        <strong>Settings are loading</strong>
        <p>Use the tab refresh action if this takes longer than expected.</p>
      </section>
    {/if}
  {/snippet}
</SettingsShell>
