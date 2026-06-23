<script lang="ts">
  import Boxes from "@lucide/svelte/icons/boxes";
  import Cpu from "@lucide/svelte/icons/cpu";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Search from "@lucide/svelte/icons/search";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { Component } from "svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { authState } from "$lib/features/auth/state/auth-state.svelte";
  import { loadAuthPanel } from "$lib/features/auth/state/auth.svelte";
  import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
  import ApiKeysSection from "./ApiKeysSection.svelte";
  import CustomProvidersSection from "./CustomProvidersSection.svelte";
  import IntegrationsSection from "./IntegrationsSection.svelte";
  import ModelsSection from "./ModelsSection.svelte";
  import SubscriptionsSection from "./SubscriptionsSection.svelte";

  type SectionId =
    | "subscriptions"
    | "api-keys"
    | "custom-providers"
    | "models"
    | "integrations";

  const sections: { id: SectionId; label: string; icon: Component }[] = [
    { id: "subscriptions", label: "Subscriptions", icon: Sparkles },
    { id: "api-keys", label: "API keys", icon: KeyRound },
    { id: "custom-providers", label: "Custom providers", icon: Boxes },
    { id: "models", label: "Models", icon: Cpu },
    { id: "integrations", label: "Integrations", icon: Search },
  ];

  const authProviders = $derived(settingsState.authProviders);
  const models = $derived(settingsState.models);

  if (!authState.catalogLoaded) void loadAuthPanel();

  function scrollToSection(id: SectionId) {
    document
      .getElementById(`auth-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<section class="settings-page">
  <aside class="settings-sidebar" aria-label="Authentication sections">
    <div class="settings-sidebar-title">
      <strong>Authentication</strong>
      <span>Providers &amp; keys</span>
    </div>
    <nav class="settings-nav">
      {#each sections as section}
        {@const Icon = section.icon}
        <button type="button" onclick={() => scrollToSection(section.id)}>
          <Icon size={16} strokeWidth={2} />
          <span>{section.label}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <ScrollArea class="settings-scroll" viewportClass="settings-viewport" type="auto">
    <div class="settings-main">
      <header class="settings-panel-header">
        <h2>Providers &amp; authentication</h2>
        <p>Connect subscriptions and API keys, add custom providers and models, and configure integrations.</p>
      </header>

      <SubscriptionsSection {authProviders} />
      <ApiKeysSection {authProviders} />
      <CustomProvidersSection {authProviders} />
      <ModelsSection {models} />
      <IntegrationsSection {authProviders} />
    </div>
  </ScrollArea>
</section>
