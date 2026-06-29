<script lang="ts">
  import type { Component } from "svelte";
  import { tick } from "svelte";
  import Bot from "@lucide/svelte/icons/bot";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Server from "@lucide/svelte/icons/server";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type {
    AuthProviderMetadata,
    ModelInfo,
    Settings,
    StatusResponse,
    UpdateSettingsRequest,
  } from "$lib/api";
  import type { ThemePreference } from "$lib/app/layout/layout-state.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import AppearanceSettingsSection from "./settings/sections/AppearanceSettingsSection.svelte";
  import AgentsSettingsSection from "./settings/sections/AgentsSettingsSection.svelte";
  import DesktopSettingsSection from "./settings/sections/DesktopSettingsSection.svelte";
  import ExploreAgentSettingsSection from "./settings/sections/ExploreAgentSettingsSection.svelte";
  import GeneralSettingsSection from "./settings/sections/GeneralSettingsSection.svelte";
  import PythonRuntimeSettingsSection from "./settings/sections/PythonRuntimeSettingsSection.svelte";
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
    | "server"
    | "python"
    | "storage"
    | "runtime";
  type GroupId = "workbench" | "agents" | "models" | "system";
  type GroupSection = { id: SectionId; label: string };
  type SettingsGroup = {
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
        { id: "agents", label: "Defaults" },
        { id: "explore", label: "Explore agent" },
        { id: "prompt-suggestions", label: "Prompt suggestions" },
      ],
    },
    {
      id: "models",
      label: "Models",
      icon: ShieldCheck,
      sections: [{ id: "models", label: "Scoped models" }],
    },
    {
      id: "system",
      label: "System",
      icon: Server,
      sections: [
        { id: "server", label: "Server" },
        { id: "python", label: "Python" },
        { id: "storage", label: "Storage" },
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

  let activeGroup = $state<GroupId>("workbench");
  let activeSubsection = $state<SectionId>("appearance");

  const activeGroupDef = $derived(
    groups.find((group) => group.id === activeGroup) ?? groups[0],
  );

  function selectGroup(id: GroupId) {
    if (id === activeGroup) return;
    activeGroup = id;
    const first = groups.find((group) => group.id === id)?.sections[0];
    if (first) activeSubsection = first.id;
    void scrollPanelToTop();
  }

  async function scrollPanelToTop() {
    await tick();
    document.querySelector(".settings-viewport")?.scrollTo({ top: 0 });
  }

  function scrollToSubsection(id: SectionId) {
    activeSubsection = id;
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Scroll-spy: highlight the sub-nav chip matching the section in view.
  $effect(() => {
    const group = activeGroupDef;
    const ready = !!settingsDraft;
    if (!ready) return;

    let observer: IntersectionObserver | undefined;
    let cancelled = false;

    void (async () => {
      await tick();
      if (cancelled) return;
      const root = document.querySelector<HTMLElement>(".settings-viewport");
      const elements = group.sections
        .map((section) => document.getElementById(`settings-${section.id}`))
        .filter((element): element is HTMLElement => element !== null);
      if (elements.length === 0) return;

      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
            );
          const id = visible[0]?.target.getAttribute("data-section");
          if (id) activeSubsection = id as SectionId;
        },
        { root, rootMargin: "0px 0px -65% 0px", threshold: 0 },
      );
      for (const element of elements) observer.observe(element);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  });

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
    </div>
    <nav class="settings-nav">
      {#each groups as group}
        {@const Icon = group.icon}
        <button
          type="button"
          class:active={activeGroup === group.id}
          aria-current={activeGroup === group.id ? "page" : undefined}
          onclick={() => selectGroup(group.id)}
        >
          <Icon size={16} strokeWidth={2} />
          <span>{group.label}</span>
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
        <header class="settings-panel-header">
          <h2>{activeGroupDef.label}</h2>
          {#if activeGroupDef.sections.length > 1}
            <div class="settings-subnav" role="tablist" aria-label="{activeGroupDef.label} sections">
              {#each activeGroupDef.sections as section}
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSubsection === section.id}
                  class:active={activeSubsection === section.id}
                  onclick={() => scrollToSubsection(section.id)}
                >
                  {section.label}
                </button>
              {/each}
            </div>
          {/if}
        </header>

        {#if activeGroup === "workbench"}
          <AppearanceSettingsSection {settingsDraft} {onThemeChange} {onSettingsChange} />
          <DesktopSettingsSection {settingsDraft} {onSettingsChange} />
        {:else if activeGroup === "agents"}
          <AgentsSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
          <ExploreAgentSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
          <PromptSuggestionsSettingsSection />
        {:else if activeGroup === "models"}
          <ScopedModelsSettingsSection {settingsDraft} {models} {authProviders} {onSettingsChange} />
        {:else if activeGroup === "system"}
          <ServerSettingsSection {settingsDraft} {onSettingsChange} />
          <PythonRuntimeSettingsSection {settingsDraft} {status} {onSettingsChange} />
          <StorageSettingsSection />
          <GeneralSettingsSection {status} />
        {/if}
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
