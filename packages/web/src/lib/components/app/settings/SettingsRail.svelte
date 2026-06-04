<script lang="ts">
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import type { ThemePreference } from "../../../state/app-state.svelte";
  import { navItems, type SettingsSection } from "./options";

  type Props = {
    activeSection: SettingsSection;
    configuredProviders: number;
    providerCount: number;
    themePreference?: ThemePreference;
  };

  let {
    activeSection = $bindable<SettingsSection>(),
    configuredProviders,
    providerCount,
    themePreference = "system",
  }: Props = $props();
</script>

<aside class="settings-rail" aria-label="Settings sections">
  <div class="rail-title app-caption">
    <Settings2 size={14} strokeWidth={2.2} />
    <span>Configuration</span>
  </div>
  {#each navItems as item}
    <button
      class="app-interactive-row"
      class:active={activeSection === item.value}
      type="button"
      onclick={() => (activeSection = item.value)}
    >
      <strong>{item.label}</strong>
      <small>{item.detail}</small>
    </button>
  {/each}
  <div class="rail-status">
    <section class="app-surface">
      <span>Theme</span>
      <strong>{themePreference}</strong>
    </section>
    <section class="app-surface">
      <span>Providers</span>
      <strong>{configuredProviders}/{providerCount} configured</strong>
    </section>
  </div>
</aside>
